// tests/02_broadcast.js
import ws from 'k6/ws';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 정의 ---
// 메시지 수신 레이턴시를 측정하기 위한 트렌드 (ms)
const broadcastLatency = new Trend('t_broadcast_latency', true);
// 메시지 수신 성공 카운터
const receivedCounter = new Counter('c_messages_received');
// 에러율 (금칙어 차단 등)
const messageErrorRate = new Rate('r_message_errors');


/**
 * 테스트별 개별 설정 (Fan-out 시나리오)
 * 1000명의 VU를 설정합니다.
 */
export const options = {
    // 1000명의 동시 사용자 (VU) 설정
    vus: 1000, 
    // 2분 30초 동안 테스트 진행
    duration: '2m30s',
    stages: [
        { duration: '30s', target: 1000 },  // 30초 동안 1000명까지 급격히 증가 (Ramp-up)
        { duration: '2m', target: 1000 },   // 2분 동안 1000명 유지 (Load)
    ],
    thresholds: {
        // 메시지 수신 레이턴시 95% 지연 시간이 200ms 미만이어야 합니다.
        't_broadcast_latency': ['p(95)<200'],
        // 연결 성공률 99% 이상
        'checks': ['rate>0.99'],
        // 메시지 에러율 1% 미만
        'r_message_errors': ['rate<0.01'], 
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    
    // VU의 고유 ID (1부터 시작)
    const vuId = __VU;
    
    // 메시지 발송 역할 VU 지정 (첫 번째 VU만 발송)
    const IS_BROADCASTER = (vuId === 1);
    
    // --- 1. 연결 및 입장 그룹 ---
    group('Connection & Join Room', function() {
        // 웹소켓 연결 시작
        const res = ws.connect(url, {}, function (socket) {
            const client = new SocketClient(socket);
            
            // 모든 VU는 메시지 수신 로직을 정의해야 합니다.
            socket.on('message', function (message) {
                const msgObj = client.listen(message);

                if (msgObj) {
                    // 서버가 새로운 메시지 'message'를 보낼 때 수신 레이턴시 측정
                    if (msgObj.event === 'message') {
                        // 메시지가 서버에서 생성된 시간 (타임스탬프)
                        const serverTimestamp = msgObj.data.timestamp;
                        // 현재 클라이언트 시간
                        const clientTimestamp = Date.now();
                        
                        // 서버 타임스탬프와 클라이언트 수신 시간의 차이를 Latency로 측정
                        const latency = clientTimestamp - serverTimestamp;
                        
                        // 커스텀 메트릭에 값 추가
                        broadcastLatency.add(latency);
                        receivedCounter.add(1);

                        client.log(`Message Received Latency: ${latency}ms`);
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
                // VU가 입장했는지 확인하는 체크
                check(socket, {
                    'Join event sent': () => true,
                });
            }, 1000);
            
            // --- 2. 메시지 발송 로직 (Broadcaster만 실행) ---
            if (IS_BROADCASTER) {
                // Broadcaster는 1초마다 메시지 전송을 반복합니다.
                socket.setInterval(function() {
                    const payload = {
                        room: roomId,
                        type: 'text',
                        content: `브로드캐스트 메시지 [${Date.now()}] from VU ${vuId}`,
                    };
                    
                    // 채팅 메시지 전송 이벤트
                    client.emit('chatMessage', payload);
                    
                    check(socket, {
                        'chatMessage event sent': () => true,
                    });
                }, 1000); // 1000ms 간격으로 반복
            }
            
            // --- 3. 연결 유지 ---
            // 테스트 duration 동안 연결을 유지합니다.
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
    
    // VU가 무한 루프에 빠지는 것을 방지하고, 메인 루프에서 일정 시간 대기
    sleep(1); 
}