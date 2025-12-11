// tests/06_interaction_stress.js
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

// --- 커스텀 메트릭 ---
const reactionLatency = new Trend('t_reaction_latency', true);
const readLatency = new Trend('t_read_latency', true);
const interactionErrorRate = new Rate('r_interaction_errors');
const interactionSuccessCounter = new Counter('c_interaction_success');

/**
 * 테스트 설정 (Interaction Stress)
 */
export const options = {
    stages: [
        { duration: '30s', target: 150 },
        { duration: '1m30s', target: 150 },
        { duration: '10s', target: 0 },
    ],
    thresholds: {
        'checks': ['rate>0.99'],
        'r_interaction_errors': ['rate<0.01'], 
        't_reaction_latency': ['p(95)<200'], 
        't_read_latency': ['p(95)<200'], 
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    const vuId = __VU;

    const params = { tags: { my_tag: 'interaction-stress' } };

    const res = ws.connect(url, params, function (socket) {
        const client = new SocketClient(socket);
        
        // [상태 관리] 실제 인터랙션할 유효한 메시지 ID 목록
        let targetMessageIds = [];
        
        // [상태 관리] 레이턴시 측정을 위한 요청 시간 기록 (Key: MsgID, Value: Timestamp)
        const pendingReactions = new Map();
        const pendingReads = new Map();

        socket.on('open', function () {
            // Jitter: 입장 분산
            socket.setTimeout(() => {
                client.emit('joinRoom', roomId);
            }, Math.random() * 2000);
        });

        socket.on('message', function (message) {
            const msgObj = client.listen(message);
            if (!msgObj) return;

            const { event, data } = msgObj;
            const now = Date.now();

            // 1. 입장 성공 및 메시지 ID 수집 (RECEIVE joinRoomSuccess)
            if (event === 'joinRoomSuccess') {
                check(data, { 'Joined room': (d) => d.roomId === roomId });

                // 서버에 저장된 최근 메시지들의 ID를 가져와서 테스트 대상으로 설정
                if (data.messages && data.messages.length > 0) {
                    targetMessageIds = data.messages.map(m => m._id);
                    if (CONFIG.DEBUG) client.log(`Collected ${targetMessageIds.length} message IDs`);
                    
                    // ID 수집 후 인터랙션 루프 시작
                    startInteractionLoop(socket, client, targetMessageIds, pendingReactions, pendingReads);
                } else {
                    client.log('Warning: No messages in room. Interaction test might fail.');
                }
            }

            // 2. 리액션 업데이트 수신 (RECEIVE messageReactionUpdate)
            if (event === 'messageReactionUpdate') {
                const mId = data.messageId;
                // 내가 요청했던 리액션에 대한 응답인지 확인
                if (pendingReactions.has(mId)) {
                    const startTime = pendingReactions.get(mId);
                    const duration = now - startTime;
                    
                    reactionLatency.add(duration);
                    interactionSuccessCounter.add(1);
                    
                    // 측정 완료 후 삭제
                    pendingReactions.delete(mId);
                }
            }

            // 3. 읽음 업데이트 수신 (RECEIVE messagesRead)
            if (event === 'messagesRead') {
                // messagesRead는 배열로 ID가 올 수 있음 (payload: { messageIds: [...] })
                const readIds = data.messageIds || [];
                
                readIds.forEach(id => {
                    if (pendingReads.has(id)) {
                        const startTime = pendingReads.get(id);
                        const duration = now - startTime;

                        readLatency.add(duration);
                        interactionSuccessCounter.add(1);
                        
                        pendingReads.delete(id);
                    }
                });
            }

            // 4. 에러 처리
            if (event === 'error') {
                // 무시할만한 에러가 아니라면 집계
                interactionErrorRate.add(1);
                if (CONFIG.DEBUG) client.error(`Interaction Error`, data);
            }
        });

        // 소켓 에러 처리
        socket.on('error', (e) => {
            if (e.error() !== 'websocket: close sent') {
                console.error(`Socket Error: ${e.error()}`);
            }
        });
    });

    check(res, { 'status is 101': (r) => r && r.status === 101 });
}

// --- 헬퍼 함수: 인터랙션 루프 ---
function startInteractionLoop(socket, client, targetIds, pendingReactions, pendingReads) {
    const roomId = CONFIG.TEST_ROOM_ID;

    // 0.5초 ~ 1.5초 간격으로 반복
    socket.setInterval(() => {
        if (targetIds.length === 0) return;

        // 랜덤 메시지 선택
        const randomMsgId = targetIds[Math.floor(Math.random() * targetIds.length)];
        
        // 랜덤 액션 결정 (0~1)
        const actionType = Math.random(); 

        // [A] 메시지 읽음 처리 (확률 30%)
        if (actionType < 0.3) {
            const payload = {
                roomId: roomId,
                messageIds: [randomMsgId]
            };
            
            // 요청 시간 기록
            pendingReads.set(randomMsgId, Date.now());
            client.emit('markMessagesAsRead', payload);

        // [B] 리액션 추가/제거 (확률 70%)
        } else {
            const type = (actionType < 0.6) ? 'add' : 'remove'; // add 30%, remove 40%
            const payload = {
                messageId: randomMsgId,
                reaction: '👍',
                type: type,
            };
            
            // 요청 시간 기록
            pendingReactions.set(randomMsgId, Date.now());
            client.emit('messageReaction', payload);
        }
        
    }, Math.random() * 1000 + 500);
}