// tests/04_room_churn.js
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 ---
const roomChurnErrorRate = new Rate('r_room_churn_errors');
const churnCycleCounter = new Counter('c_churn_cycles');

/**
 * 테스트 설정 (Room Churn 시나리오)
 */
export const options = {
    // stages 사용 시 최상위 vus 생략 권장
    stages: [
        { duration: '30s', target: 200 },  // 30초 동안 200명까지 증가
        { duration: '1m30s', target: 200 }, // 1분 30초 동안 유지
        { duration: '10s', target: 0 },     // 종료
    ],
    thresholds: {
        'checks': ['rate>0.99'],
        'r_room_churn_errors': ['rate<0.01'], 
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const vuId = __VU;

    // 테스트에 사용할 두 개의 방 ID (서버 설정에 따라 유효한 ID가 필요할 수 있음)
    // 서버가 임의의 문자열로 방 생성을 허용한다고 가정합니다.
    const roomA = `churn_room_A_${vuId % 10}`; 
    const roomB = `churn_room_B_${vuId % 10}`;

    const params = { tags: { my_tag: 'room-churn-test' } };

    const res = ws.connect(url, params, function (socket) {
        const client = new SocketClient(socket);
        
        // [상태 관리] 현재 목표로 하는 방과 상태
        let targetRoom = roomA; 
        
        // 연결이 열리면 첫 번째 방 입장 시도
        socket.on('open', function () {
            // Jitter: 동시에 몰리지 않도록 0~1초 사이 랜덤 대기 후 시작
            socket.setTimeout(() => {
                client.emit('joinRoom', targetRoom);
            }, Math.random() * 1000);
        });

        socket.on('message', function (message) {
            const msgObj = client.listen(message);
            if (!msgObj) return;

            const { event, data } = msgObj;

            // 1. 입장 성공 (RECEIVE joinRoomSuccess)
            if (event === 'joinRoomSuccess') {
                check(data, {
                    'Joined correct room': (d) => d.roomId === targetRoom,
                });

                // 성공 로그 (디버그 모드 시)
                if (CONFIG.DEBUG) {
                    client.log(`Joined ${targetRoom}`, `Participants: ${data.participants?.length}`);
                }

                // [핵심 로직] "입장 성공 즉시(약간의 텀 후) 퇴장"
                // 사람이 너무 빠르게 나가는 것을 방지하고 서버 처리를 위해 500ms 대기
                socket.setTimeout(() => {
                    // 퇴장 요청
                    client.emit('leaveRoom', targetRoom);
                    
                    // 퇴장 후 다음 행동 예약:
                    // 방 교체 (A <-> B)
                    targetRoom = (targetRoom === roomA) ? roomB : roomA;

                    // "잠시 후(500ms~1500ms) 다른 방 입장"
                    // leaveRoom에 대한 명시적 Success 이벤트가 없으므로
                    // 타이머로 다음 입장을 트리거합니다.
                    socket.setTimeout(() => {
                        client.emit('joinRoom', targetRoom);
                        churnCycleCounter.add(1); // 사이클 1회 완료로 간주
                    }, Math.random() * 1000 + 500);

                }, 500); 
            }

            // 2. 에러 처리
            if (event === 'error' || event === 'joinRoomError') {
                // 에러 발생 시 집계
                roomChurnErrorRate.add(1);
                
                // [회복 로직] 에러가 나더라도 테스트가 멈추지 않도록 재시도
                // 3초 뒤에 현재 타겟 룸으로 다시 입장 시도
                socket.setTimeout(() => {
                    client.emit('joinRoom', targetRoom);
                }, 3000);

                if (CONFIG.DEBUG) {
                    client.error(`Churn Error in ${targetRoom}`, data);
                }
            }
        });

        // 소켓 에러 처리
        socket.on('error', function (e) {
            if (e.error() !== 'websocket: close sent') {
                console.error(`VU ${vuId} Socket Error: ${e.error()}`);
            }
        });
        
        // 3. 테스트 종료 시점이 되면 연결 종료
        // (option duration에 의해 자동 종료되지만 명시적 종료도 가능)
    });

    check(res, { 'status is 101': (r) => r && r.status === 101 });
}