// tests/02_broadcast.js
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 정의 ---
// Broadcast Latency: 서버 타임스탬프 vs 수신 시점 차이
const broadcastLatency = new Trend('t_broadcast_latency', true); 
const receivedCounter = new Counter('c_messages_received');
const messageErrorRate = new Rate('r_message_errors');

/**
 * 테스트 설정 (Fan-out 시나리오)
 */
export const options = {
    // stages를 사용하므로 최상위 vus는 제거하거나 주석 처리
    // vus: 1000, 
    
    stages: [
        { duration: '30s', target: 1000 },  // 30초 동안 1000명까지 연결 (Ramp-up)
        { duration: '2m', target: 1000 },   // 2분 동안 부하 유지
        { duration: '10s', target: 0 },     // 10초 동안 연결 종료
    ],
    thresholds: {
        // 메시지 수신 레이턴시 P95가 500ms 미만 (네트워크 환경 고려하여 약간 상향 조정)
        't_broadcast_latency': ['p(95)<500'], 
        'r_message_errors': ['rate<0.01'], // 에러율 1% 미만
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    
    // VU ID (1 ~ 1000)
    const vuId = __VU;
    
    // VU 1번만 "Broadcaster" 역할을 수행
    const IS_BROADCASTER = (vuId === 1);

    const params = { 
        tags: { my_tag: 'broadcast-test' } 
    };

    const res = ws.connect(url, params, function (socket) {
        const client = new SocketClient(socket);
        
        socket.on('open', function() {
            // [중요] 모든 유저가 동시에 joinRoom을 날리지 않도록 랜덤 딜레이(Jitter) 적용
            // 1초 ~ 5초 사이에 랜덤하게 입장
            const randomDelay = Math.random() * 4000 + 1000; 

            socket.setTimeout(function () {
                // 문서: SEND joinRoom
                client.emit('joinRoom', roomId);
            }, randomDelay);
        });

        // 메시지 수신 핸들러 (모든 VU 공통)
        socket.on('message', function (message) {
            const msgObj = client.listen(message);

            if (!msgObj) return;

            // 1. 메시지 수신 (RECEIVE message)
            if (msgObj.event === 'message') {
                const data = msgObj.data;
                
                // 내가 보낸 메시지가 다시 돌아오는 경우(Echo)도 측정에 포함됨
                if (data.type === 'text') {
                    // 서버가 찍어준 타임스탬프
                    const serverTs = data.timestamp; 
                    const now = Date.now();
                    
                    // Latency 계산 (서버 시간과 클라이언트 시간 동기화 주의)
                    const latency = now - serverTs;

                    // 유효한 양수 값일 때만 기록 (시간 동기화 이슈 방지용 필터)
                    if (latency >= 0) {
                        broadcastLatency.add(latency);
                    }
                    receivedCounter.add(1);
                }
            }

            // 2. 에러 처리 (RECEIVE error)
            if (msgObj.event === 'error' || msgObj.event === 'joinRoomError') {
                messageErrorRate.add(1);
                client.error(`Error on VU ${vuId}`, msgObj.data);
            }
        });

        // --- Broadcaster 로직 (VU #1) ---
        if (IS_BROADCASTER) {
            // 연결 후 5초 뒤부터 메시지 전송 시작 (모두가 입장할 시간 확보)
            socket.setTimeout(() => {
                console.log(`VU ${vuId}: Starting Broadcast...`);
                
                // 1초 간격으로 메시지 전송
                socket.setInterval(function() {
                    // 문서: SEND chatMessage
                    const payload = {
                        room: roomId,
                        type: 'text',
                        content: `Broadcast [${Date.now()}] from VU ${vuId}`,
                    };
                    
                    client.emit('chatMessage', payload);
                }, 1000);
            }, 5000);
        }

        // --- 연결 종료 및 에러 핸들링 ---
        socket.on('close', () => {
            if (CONFIG.DEBUG) console.log(`VU ${vuId}: Disconnected`);
        });

        socket.on('error', (e) => {
            if (e.error() !== 'websocket: close sent') {
                console.error(`VU ${vuId} Socket Error: ${e.error()}`);
            }
        });
    });

    check(res, { 'status is 101': (r) => r && r.status === 101 });
}