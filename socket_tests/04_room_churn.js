// tests/04_room_churn.js
import ws from 'k6/ws';
import { check, group, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 정의 ---
// Join/Leave 에러율 (JOIN_ROOM_ERROR, ROOM_NOT_FOUND 등)
const roomChurnErrorRate = new Rate('r_room_churn_errors');
// 성공적인 Join/Leave 사이클 카운터
const churnCycleCounter = new Counter('c_churn_cycles');

// 현재 VU가 속한 방의 상태를 저장하는 객체
const roomState = {}; 

/**
 * 테스트별 개별 설정 (Room Churn 시나리오)
 * 200명의 VU가 방을 빠르게 들락날락합니다.
 */
export const options = {
    // 200명의 동시 사용자 (VU) 설정
    vus: 200, 
    // 2분 동안 테스트 진행
    duration: '2m',
    stages: [
        { duration: '30s', target: 200 },  // 30초 동안 200명까지 증가
        { duration: '1m30s', target: 200 }, // 1분 30초 동안 유지
    ],
    thresholds: {
        // 연결 성공률 99% 이상
        'checks': ['rate>0.99'],
        // 방 입장/퇴장 에러율 0.5% 미만
        'r_room_churn_errors': ['rate<0.005'], 
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const vuId = __VU;
    
    // 각 VU는 고유 ID를 기반으로 2개의 가상 방을 번갈아 사용합니다.
    const roomA = `churn_room_A_${vuId % 10}`; // 10개 그룹으로 방 분산
    const roomB = `churn_room_B_${vuId % 10}`;
    
    let currentRoom = roomA;

    // --- 1. 연결 및 초기 상태 설정 ---
    group('Connection & Room Cycle Setup', function() {
        const res = ws.connect(url, {}, function (socket) {
            const client = new SocketClient(socket);
            
            // --- 2. 이벤트 수신 핸들러 ---
            socket.on('message', function (message) {
                const msgObj = client.listen(message);

                if (msgObj) {
                    // 입장 성공 확인
                    if (msgObj.event === 'joinRoomSuccess') {
                        check(msgObj, {
                            'Join Success for current room': (obj) => obj.data.roomId === currentRoom,
                        });
                        roomState[vuId] = currentRoom; // 현재 방 상태 업데이트
                        client.log(`Joined Room ${currentRoom}`, msgObj.data.participants.length);
                    }

                    // 에러 이벤트 처리 (JOIN_ROOM_ERROR, 일반 error)
                    if (msgObj.event === 'joinRoomError' || (msgObj.event === 'error' && !msgObj.data.code)) {
                        roomChurnErrorRate.add(1);
                        client.error(`Room Churn Error (${msgObj.event})`, msgObj.data);
                        check(msgObj, { 'Join/Leave Error': () => false }); // 체크 실패
                    }
                }
            });

            // --- 3. 주기적인 입장/퇴장 로직 ---
            // 2초 간격으로 반복하여 입장/퇴장 사이클을 수행합니다.
            socket.setInterval(function() {
                
                if (roomState[vuId] === currentRoom) {
                    // 3-A. 현재 방에서 퇴장 (Leave)
                    client.emit('leaveRoom', currentRoom);
                    
                    // 다음 방을 결정
                    currentRoom = (currentRoom === roomA) ? roomB : roomA;
                    
                    // 상태 초기화
                    delete roomState[vuId]; 
                    client.log(`Left Room, Preparing to join ${currentRoom}`);
                    
                    // 사이클 완료 카운트
                    churnCycleCounter.add(1);

                } else {
                    // 3-B. 새로운 방에 입장 (Join)
                    client.emit('joinRoom', currentRoom);
                    client.log(`Attempting to join Room ${currentRoom}`);
                }
                
            }, 2000); // 2000ms (2초) 간격으로 Join/Leave 반복

            // --- 4. 연결 유지 ---
            socket.on('error', function (e) {
                if (e.error() != 'websocket: close sent') {
                    client.error('WebSocket Error', e.error());
                }
            });
        });

        // 연결 자체 성공 여부 체크
        check(res, { 'status is 101': (r) => r && r.status === 101 });
    });
    
    // 메인 루프에서 일정 시간 대기
    sleep(1); 
}