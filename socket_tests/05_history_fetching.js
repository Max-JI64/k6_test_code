// tests/05_history_fetching.js
import ws from 'k6/ws';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 정의 ---
// DB 조회 요청부터 응답까지의 총 지연 시간 측정 (ms)
const fetchLatency = new Trend('t_fetch_latency', true);
// 조회 실패/에러율 (LOAD_ERROR, UNAUTHORIZED 등)
const fetchErrorRate = new Rate('r_fetch_errors');
// 성공적인 조회 완료 횟수
const fetchSuccessCounter = new Counter('c_fetch_success');

// 조회 시작 시간을 저장할 Map (요청/응답 지연 시간 측정을 위해 필요)
const fetchStartTime = {}; 

// 테스트에 사용할 고정된 과거 타임스탬프 (밀리초)
// DB에 충분한 메시지가 있다고 가정하고, 넉넉한 과거 시점으로 설정
const BEFORE_TIMESTAMP = 1609459200000; // 2021년 1월 1일 00:00:00 UTC

/**
 * 테스트별 개별 설정 (History Fetching 시나리오)
 * DB에 부하를 줄 250명의 VU를 설정합니다.
 */
export const options = {
    // 250명의 동시 사용자 (VU) 설정
    vus: 250, 
    // 1분 30초 동안 테스트 진행
    duration: '1m30s',
    stages: [
        { duration: '20s', target: 250 },  // 20초 동안 250명까지 증가
        { duration: '1m10s', target: 250 }, // 1분 10초 동안 유지
    ],
    thresholds: {
        // 연결 성공률 99% 이상
        'checks': ['rate>0.99'],
        // 조회 에러율 1% 미만 (LOAD_ERROR 등)
        'r_fetch_errors': ['rate<0.01'], 
        // 조회 레이턴시 95% 지연 시간이 400ms 미만이어야 합니다.
        't_fetch_latency': ['p(95)<400'], 
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    const vuId = __VU;
    
    // --- 1. 연결 및 초기 상태 설정 ---
    group('Connection & History Setup', function() {
        const res = ws.connect(url, {}, function (socket) {
            const client = new SocketClient(socket);
            
            // --- 2. 이벤트 수신 핸들러 ---
            socket.on('message', function (message) {
                const msgObj = client.listen(message);

                if (msgObj) {
                    // 이전 메시지 로드 완료 응답 수신 확인
                    if (msgObj.event === 'previousMessagesLoaded') {
                        // 요청 시작 시간과 현재 시간 차이를 계산
                        const latency = Date.now() - (fetchStartTime[vuId] || Date.now());
                        fetchLatency.add(latency);
                        fetchSuccessCounter.add(1);
                        
                        // 응답 데이터 유효성 체크
                        check(msgObj.data.messages, {
                            'Received message array not empty': (msgs) => msgs.length > 0,
                            'Has more flag present': (msgs) => typeof msgObj.data.hasMore === 'boolean',
                        });
                        
                        client.log(`Fetch Success Latency: ${latency}ms`, `Messages: ${msgObj.data.messages.length}`);
                        delete fetchStartTime[vuId]; // 측정 완료 후 초기화
                    }
                    
                    // 메시지 로드 시작 (선택적)
                    if (msgObj.event === 'messageLoadStart') {
                        // DB 조회 시작 시간 기록
                        fetchStartTime[vuId] = Date.now();
                        client.log('Message Load Started');
                    }

                    // 에러 이벤트 처리 (LOAD_ERROR 등)
                    if (msgObj.event === 'error') {
                        // DB 조회 관련 에러 코드 체크 (문서: LOAD_ERROR)
                        if (msgObj.data.code === 'LOAD_ERROR') {
                            fetchErrorRate.add(1);
                            client.error(`Fetch Error on VU ${vuId}`, msgObj.data);
                            check(msgObj, { 'Fetch Error (LOAD_ERROR)': () => false });
                        }
                    }
                }
            });

            // 1초 뒤 방 입장 시도
            socket.setTimeout(function () {
                client.emit('joinRoom', roomId);
                check(socket, { 'Join event sent': () => true });
            }, 1000);
            
            // --- 3. 주기적인 메시지 조회 요청 ---
            // 3초 간격으로 반복하여 이전 메시지 조회를 요청합니다.
            // (입장 성공을 기다리지 않고, 입장 이벤트 전송 직후부터 요청을 시도하여 부하를 높임)
            socket.setInterval(function() {
                const payload = {
                    roomId: roomId,
                    limit: 30,
                    before: BEFORE_TIMESTAMP,
                };
                
                // 조회 요청 이벤트
                client.emit('fetchPreviousMessages', payload);
                
                // 요청 시간 기록 (리스너에서 사용)
                fetchStartTime[vuId] = Date.now();

                check(socket, { 'Fetch request sent': () => true });
                
            }, 3000); // 3000ms (3초) 간격으로 조회 요청 반복

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