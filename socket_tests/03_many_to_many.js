// tests/03_many_to_many.js
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 정의 ---
const sentCounter = new Counter('c_messages_sent');
const receivedTotalCounter = new Counter('c_messages_received_total');
const messageErrorRate = new Rate('r_message_errors');
const messageLatency = new Trend('t_message_latency', true);

/**
 * 테스트 설정 (Many-to-Many 시나리오)
 * 100명의 VU가 활발하게 대화합니다.
 */
export const options = {
    // stages를 사용하므로 최상위 vus는 제거 (혼동 방지)
    // vus: 100, 
    stages: [
        { duration: '30s', target: 100 },  // 30초 동안 100명까지 증가
        { duration: '2m30s', target: 100 }, // 2분 30초 동안 부하 유지
        { duration: '10s', target: 0 },     // 종료
    ],
    thresholds: {
        'checks': ['rate>0.99'],
        'r_message_errors': ['rate<0.01'], 
        // 다대다는 서버 부하가 높으므로 레이턴시 허용치를 약간 여유 있게 잡음
        't_message_latency': ['p(95)<500'],
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    const vuId = __VU;
    
    // 메시지 발송 간격 (3초 ~ 6초 사이의 무작위 값)
    // VU마다 서로 다른 간격을 가집니다.
    const sendInterval = Math.random() * 3000 + 3000;
    
    const params = { 
        tags: { my_tag: 'many-to-many-test' } 
    };

    const res = ws.connect(url, params, function (socket) {
        const client = new SocketClient(socket);
        
        socket.on('open', function () {
            // [수정 1] 입장 Thundering Herd 방지
            // 연결 직후 100명이 동시에 join을 요청하지 않고, 1~3초 사이에 분산되어 입장
            const randomJoinDelay = Math.random() * 2000 + 1000;
            
            socket.setTimeout(function() {
                client.emit('joinRoom', roomId);
            }, randomJoinDelay);
        });

        socket.on('message', function (message) {
            const msgObj = client.listen(message);
            if (!msgObj) return;

            const { event, data } = msgObj;

            // [수정 2] 입장 성공 확인 후 메시지 전송 시작
            // 방에 확실히 들어온 뒤에 떠들기 시작해야 에러가 없습니다.
            if (event === 'joinRoomSuccess') {
                check(data, { 'Joined room': (d) => d.roomId === roomId });

                // 입장 후 바로 말하지 않고, 사람처럼 약간의 텀(0.5~2초)을 두고 시작
                socket.setTimeout(() => {
                    // 주기적 메시지 전송 시작
                    socket.setInterval(function() {
                        const payload = {
                            room: roomId,
                            type: 'text',
                            content: `VU ${vuId}: Chatting... [${Date.now()}]`,
                        };
                        
                        client.emit('chatMessage', payload);
                        sentCounter.add(1);
                        
                    }, sendInterval); 
                }, Math.random() * 1500 + 500);
            }

            // 메시지 수신 처리
            if (event === 'message') {
                if (data.type === 'text') {
                    receivedTotalCounter.add(1); 
                    
                    const latency = Date.now() - data.timestamp;
                    // 시간 동기화 오차로 인한 마이너스 값 제외
                    if (latency >= 0) {
                        messageLatency.add(latency);
                    }
                }
            }

            // 에러 처리
            if (event === 'error' || event === 'joinRoomError') {
                messageErrorRate.add(1);
                // 에러 로그는 너무 많을 수 있으므로 디버그 모드이거나 치명적일 때만 출력 권장
                if (CONFIG.DEBUG) {
                    client.error(`Error on VU ${vuId}`, data);
                }
            }
        });

        // 소켓 에러 핸들링
        socket.on('error', function (e) {
            if (e.error() !== 'websocket: close sent') {
                console.error(`VU ${vuId} Socket Error: ${e.error()}`);
            }
        });
    });

    check(res, { 'status is 101': (r) => r && r.status === 101 });
}