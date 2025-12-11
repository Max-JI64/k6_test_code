// tests/01_connection.js
import ws from 'k6/ws';
import { check } from 'k6';
import { CONFIG } from '../utils/config.js';
import { SocketClient } from '../utils/socket-io.js';

/**
 * 테스트별 개별 설정 (Duration, VUs)
 * 필요에 따라 이 부분만 수정하여 테스트 강도를 조절합니다.
 */
export const options = {
    stages: [
        { duration: '10s', target: 10 },  // 10초 동안 10명까지 서서히 증가 (Ramp-up)
        { duration: '30s', target: 10 },  // 30초 동안 10명 유지 (Soak)
        { duration: '10s', target: 0 },   // 10초 동안 서서히 종료 (Ramp-down)
    ],
    // 임계값 설정 (에러율 1% 미만이어야 성공)
    thresholds: {
        checks: ['rate>0.99'], 
    },
};

export default function () {
    const url = CONFIG.BASE_URL;
    const roomId = CONFIG.TEST_ROOM_ID;
    
    // 웹소켓 연결 시작
    const res = ws.connect(url, {}, function (socket) {
        const client = new SocketClient(socket);

        socket.on('open', function open() {
            client.log('Connection', 'WebSocket Opened');
        });

        socket.on('message', function (message) {
            // Socket.IO 프로토콜 처리 및 파싱
            const msgObj = client.listen(message);

            if (msgObj) {
                // 1. 입장 성공 확인
                if (msgObj.event === 'joinRoomSuccess') {
                    check(msgObj, {
                        'Room joined successfully': (obj) => obj.data.roomId === roomId,
                    });
                }
                
                // 2. 입장 실패 등 에러 이벤트 확인
                if (msgObj.event === 'joinRoomError') {
                    client.error('Join failed', msgObj.data);
                    check(msgObj, {
                        'Join failed': () => false, // 체크 실패로 간주
                    });
                }
            }
        });

        // 연결 후 1초 뒤 방 입장 시도
        socket.setTimeout(function () {
            client.emit('joinRoom', roomId);
        }, 1000);

        // 테스트 종료 시점까지 연결 유지 (에러 발생 시 로그 출력)
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
}