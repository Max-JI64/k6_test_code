// tests/05_history_fetching.js
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 ---
const fetchLatency = new Trend('t_fetch_latency', true);
const fetchErrorRate = new Rate('r_fetch_errors');
const fetchSuccessCounter = new Counter('c_fetch_success');

/**
 * 테스트 설정 (History Fetching)
 */
export const options = {
    // stages를 사용하므로 최상위 vus 생략
    stages: [
        { duration: '20s', target: 250 },  // 20초 동안 250명까지 증가
        { duration: '1m10s', target: 250 }, // 1분 10초 동안 유지
        { duration: '10s', target: 0 },     // 종료
    ],
    thresholds: {
        'checks': ['rate>0.99'],
        'r_fetch_errors': ['rate<0.01'], 
        't_fetch_latency': ['p(95)<400'], 
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    const vuId = __VU;

    // [상태 관리] 레이턴시 측정을 위한 시작 시간
    let requestStartTime = 0;
    // [상태 관리] 중복 요청 방지 플래그
    let isFetching = false;

    const params = { tags: { my_tag: 'history-fetch-test' } };

    const res = ws.connect(url, params, function (socket) {
        const client = new SocketClient(socket);
        
        // 헬퍼 함수: 메시지 로드 요청 보내기
        function sendFetchRequest() {
            if (isFetching) return; // 이미 요청 중이면 스킵
            
            isFetching = true;
            requestStartTime = Date.now();
            
            // 문서: SEND fetchPreviousMessages
            const payload = {
                roomId: roomId,
                limit: 30, // 한 번에 가져올 개수
                // 테스트 목적상 매번 랜덤한 과거 시점을 조회하여 DB 캐싱 효과를 최소화 (Hard I/O 유도)
                // 예: 최근 1년 ~ 1일 전 사이의 랜덤 타임스탬프
                before: Date.now() - Math.floor(Math.random() * 31536000000), 
            };
            
            client.emit('fetchPreviousMessages', payload);
        }

        socket.on('open', function () {
            // 연결 직후 분산 입장 (Thundering Herd 방지)
            socket.setTimeout(() => {
                client.emit('joinRoom', roomId);
            }, Math.random() * 2000);
        });

        socket.on('message', function (message) {
            const msgObj = client.listen(message);
            if (!msgObj) return;

            const { event, data } = msgObj;

            // 1. 입장 성공 시 최초 조회 시작 (RECEIVE joinRoomSuccess)
            if (event === 'joinRoomSuccess') {
                check(data, { 'Joined room': (d) => d.roomId === roomId });
                // 입장 성공 후 0.5초 뒤 조회 시작
                socket.setTimeout(sendFetchRequest, 500);
            }

            // 2. 조회 완료 응답 (RECEIVE previousMessagesLoaded)
            if (event === 'previousMessagesLoaded') {
                // 레이턴시 계산
                const now = Date.now();
                const latency = now - requestStartTime;
                
                // 유효한 측정값만 기록
                if (requestStartTime > 0 && latency >= 0) {
                    fetchLatency.add(latency);
                }
                
                fetchSuccessCounter.add(1);
                isFetching = false; // 플래그 해제
                requestStartTime = 0;

                // 데이터 검증
                check(data, {
                    'Has messages array': (d) => Array.isArray(d.messages),
                });

                if (CONFIG.DEBUG) {
                    client.log(`Fetch Latency: ${latency}ms, Count: ${data.messages.length}`);
                }

                // [Loop] 응답을 받으면 잠시 대기 후 바로 다음 요청 (DB에 지속적인 부하)
                // 1초 ~ 2초 사이 랜덤 대기
                socket.setTimeout(sendFetchRequest, Math.random() * 1000 + 1000);
            }

            // 3. 에러 처리 (RECEIVE error)
            if (event === 'error') {
                // LOAD_ERROR 또는 기타 에러 확인
                if (data.code === 'LOAD_ERROR' || data.code === 'UNAUTHORIZED') {
                    fetchErrorRate.add(1);
                    client.error(`Fetch Error`, data);
                    
                    // 에러 발생 시 플래그 초기화하고 잠시 후 재시도
                    isFetching = false;
                    socket.setTimeout(sendFetchRequest, 3000);
                }
            }
        });

        socket.on('error', (e) => {
            if (e.error() !== 'websocket: close sent') {
                console.error(`Socket Error: ${e.error()}`);
            }
        });
    });

    check(res, { 'status is 101': (r) => r && r.status === 101 });
}