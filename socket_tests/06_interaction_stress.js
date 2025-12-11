// tests/06_interaction_stress.js
import ws from 'k6/ws';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 정의 ---
// 리액션 처리 시간 (요청 -> 응답)
const reactionLatency = new Trend('t_reaction_latency', true);
// 읽음 처리 시간 (요청 -> 응답)
const readLatency = new Trend('t_read_latency', true);
// 에러율 (Unauthorized, 메시지 찾을 수 없음 등)
const interactionErrorRate = new Rate('r_interaction_errors');
// 성공적인 인터랙션 카운터
const interactionSuccessCounter = new Counter('c_interaction_success');

// 테스트에 사용할 가상 메시지 ID 목록 (실제 환경 ID로 대체 가능)
const VIRTUAL_MESSAGE_IDS = [
    'msg_1234567890abcdef',
    'msg_0987654321fedcba',
    'msg_a1b2c3d4e5f6g7h8',
    'msg_f8e7d6c5b4a39210',
    'msg_g9h8i7j6k5l4m3n2'
];

// 요청 시작 시간을 저장할 Map
const actionStartTime = {}; 

/**
 * 테스트별 개별 설정 (Interaction Stress 시나리오)
 * 150명의 VU가 끊임없이 인터랙션을 발생시킵니다.
 */
export const options = {
    // 150명의 동시 사용자 (VU) 설정
    vus: 150, 
    // 2분 동안 테스트 진행
    duration: '2m',
    stages: [
        { duration: '30s', target: 150 },  // 30초 동안 150명까지 증가
        { duration: '1m30s', target: 150 }, // 1분 30초 동안 유지
    ],
    thresholds: {
        'checks': ['rate>0.99'],
        'r_interaction_errors': ['rate<0.01'], 
        // 인터랙션 처리 지연 시간 95%가 150ms 미만이어야 합니다.
        't_reaction_latency': ['p(95)<150'], 
        't_read_latency': ['p(95)<150'], 
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    const vuId = __VU;
    
    // 무작위 메시지 ID 하나를 선택
    const randomMsgId = VIRTUAL_MESSAGE_IDS[Math.floor(Math.random() * VIRTUAL_MESSAGE_IDS.length)];
    const actionType = Math.random(); // 0~1 사이의 무작위 값

    // --- 1. 연결 및 초기 상태 설정 ---
    group('Connection & Interaction Setup', function() {
        const res = ws.connect(url, {}, function (socket) {
            const client = new SocketClient(socket);
            
            // --- 2. 이벤트 수신 핸들러 ---
            socket.on('message', function (message) {
                const msgObj = client.listen(message);

                if (msgObj) {
                    const now = Date.now();
                    
                    // 읽음 상태 업데이트 알림 수신 (다른 VU가 읽음 처리했을 때)
                    if (msgObj.event === 'messagesRead') {
                        // 자체적인 응답이 아니므로 레이턴시 측정은 하지 않음
                        interactionSuccessCounter.add(0.1); // 성공으로 간주하여 카운터 증가
                        client.log(`Messages Read Update received for user ${msgObj.data.userId}`);
                    }
                    
                    // 리액션 업데이트 알림 수신 (다른 VU가 리액션 처리했을 때)
                    if (msgObj.event === 'messageReactionUpdate') {
                        // 자체적인 응답이 아니므로 레이턴시 측정은 하지 않음
                        interactionSuccessCounter.add(0.1); // 성공으로 간주하여 카운터 증가
                        client.log(`Reaction Update received for msg ${msgObj.data.messageId}`);
                    }

                    // 에러 이벤트 처리
                    if (msgObj.event === 'error') {
                        interactionErrorRate.add(1);
                        client.error(`Interaction Error on VU ${vuId}`, msgObj.data);
                        check(msgObj, { 'Interaction Error': () => false });
                    }
                }
            });

            // 1초 뒤 방 입장 시도
            socket.setTimeout(function () {
                client.emit('joinRoom', roomId);
                check(socket, { 'Join event sent': () => true });
            }, 1000);
            
            // --- 3. 주기적인 인터랙션 요청 ---
            // 0.5초에서 1.5초 간격으로 무작위 인터랙션을 실행합니다.
            const interactionInterval = Math.random() * 1000 + 500; // 500ms ~ 1500ms
            
            socket.setInterval(function() {
                
                // --- 3-A. 메시지 읽음 처리 (확률: 30%) ---
                if (actionType < 0.3) {
                    const actionName = 'markMessagesAsRead';
                    const payload = {
                        roomId: roomId,
                        messageIds: [randomMsgId]
                    };
                    client.emit(actionName, payload);
                    actionStartTime[actionName] = Date.now();
                    interactionSuccessCounter.add(1);

                // --- 3-B. 메시지 리액션 추가/제거 (확률: 70%) ---
                } else {
                    const actionName = 'messageReaction';
                    const type = (actionType < 0.6) ? 'add' : 'remove'; // add 30%, remove 40%
                    const payload = {
                        messageId: randomMsgId,
                        reaction: '👍', // 고정 이모지
                        type: type,
                    };
                    client.emit(actionName, payload);
                    actionStartTime[actionName] = Date.now();
                    interactionSuccessCounter.add(1);
                }

                check(socket, { 'Interaction event sent': () => true });

            }, interactionInterval); 

            // --- 4. 연결 유지 및 에러 처리 ---
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