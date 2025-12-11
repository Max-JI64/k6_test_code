// tests/03_many_to_many.js
import ws from 'k6/ws';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 정의 ---
// 전송 성공 카운터
const sentCounter = new Counter('c_messages_sent');
// 수신 성공 카운터 (모든 VU가 수신한 총합)
const receivedTotalCounter = new Counter('c_messages_received_total');
// 에러율 (MESSAGE_ERROR, MESSAGE_REJECTED 등)
const messageErrorRate = new Rate('r_message_errors');
// 메시지 수신 레이턴시 (선택적 측정)
const messageLatency = new Trend('t_message_latency', true);


/**
 * 테스트별 개별 설정 (Many-to-Many 시나리오)
 * 100명의 VU가 활발하게 활동합니다.
 */
export const options = {
    // 100명의 동시 사용자 (VU) 설정
    vus: 100, 
    // 3분 동안 테스트 진행
    duration: '3m',
    stages: [
        { duration: '30s', target: 100 },  // 30초 동안 100명까지 증가 (Ramp-up)
        { duration: '2m30s', target: 100 }, // 2분 30초 동안 유지 (Load)
    ],
    thresholds: {
        // 연결 성공률 99% 이상
        'checks': ['rate>0.99'],
        // 메시지 에러율 1% 미만 (금칙어 등으로 거부되는 경우 포함)
        'r_message_errors': ['rate<0.01'], 
        // 메시지 레이턴시 95% 지연 시간이 300ms 미만 (Fan-out보다 처리 부하가 높음)
        't_message_latency': ['p(95)<300'],
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    
    const vuId = __VU;
    
    // 메시지 발송 간격 (3초 ~ 6초 사이의 무작위 값)
    const sendInterval = Math.random() * 3000 + 3000;
    
    // --- 1. 연결 및 입장 그룹 ---
    group('Connection & Join Room', function() {
        const res = ws.connect(url, {}, function (socket) {
            const client = new SocketClient(socket);
            
            socket.on('message', function (message) {
                const msgObj = client.listen(message);

                if (msgObj) {
                    // 서버가 새로운 메시지 'message'를 보낼 때 수신 처리
                    if (msgObj.event === 'message') {
                        // 모든 VU가 메시지를 받았으므로 전체 수신 카운터를 증가시킵니다.
                        receivedTotalCounter.add(1); 
                        
                        // 서버 타임스탬프 기반 레이턴시 측정
                        const latency = Date.now() - msgObj.data.timestamp;
                        messageLatency.add(latency);
                        
                        client.log(`Message Latency: ${latency}ms`);
                    }

                    // 에러 이벤트 처리
                    if (msgObj.event === 'error' || msgObj.event === 'joinRoomError') {
                        messageErrorRate.add(1);
                        client.error(`Error on VU ${vuId}`, msgObj.data);
                    }
                }
            });

            // 1초 뒤 방 입장 시도
            socket.setTimeout(function () {
                client.emit('joinRoom', roomId);
                check(socket, { 'Join event sent': () => true });
            }, 1000);
            
            // --- 2. 메시지 발송 로직 (모든 VU가 실행) ---
            
            // 모든 VU는 무작위 간격(sendInterval)에 따라 메시지를 전송합니다.
            socket.setInterval(function() {
                const payload = {
                    room: roomId,
                    type: 'text',
                    content: `VU ${vuId}: 실시간으로 떠들고 있습니다. [${Date.now()}]`,
                };
                
                // 채팅 메시지 전송 이벤트
                client.emit('chatMessage', payload);
                sentCounter.add(1); // 전송 성공 카운트 증가
                
                check(socket, { 'chatMessage event sent': () => true });
                
            }, sendInterval); // 각 VU마다 다른 간격으로 설정됨
            
            // --- 3. 연결 유지 ---
            socket.on('error', function (e) {
                if (e.error() != 'websocket: close sent') {
                    client.error('WebSocket Error', e.error());
                }
            });

            socket.on('close', function () {
                client.log('Connection', 'Closed');
            });
        });

        // 연결 자체 성공 여부 체크
        check(res, { 'status is 101': (r) => r && r.status === 101 });
    });
    
    // 메인 루프에서 일정 시간 대기
    sleep(1); 
}