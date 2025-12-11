// utils/socket-io.js
import { CONFIG } from './config.js';

// Socket.IO Engine.IO v4 Protocol Codes
const PACKET_TYPES = {
    PING: '2',
    PONG: '3',
    MESSAGE: '4',
};

const MESSAGE_TYPES = {
    CONNECT: '0',
    DISCONNECT: '1',
    EVENT: '2',
    ACK: '3',
    ERROR: '4',
};

/**
 * Socket.IO 메시지를 파싱하고 이벤트를 처리하는 클래스 (로깅 기능 포함)
 */
export class SocketClient {
    constructor(socket) {
        this.socket = socket;
    }

    /**
     * [디버그용] 로그 출력
     * CONFIG.DEBUG가 true일 때만 출력됨
     */
    log(prefix, message = '') {
        if (CONFIG.DEBUG) {
            console.log(`[DEBUG] ${prefix}:`, typeof message === 'object' ? JSON.stringify(message) : message);
        }
    }

    /**
     * [에러용] 로그 출력
     * 항상 출력됨
     */
    error(prefix, err = '') {
        console.error(`[ERROR] ${prefix}:`, typeof err === 'object' ? JSON.stringify(err) : err);
    }

    /**
     * 서버로 이벤트 전송
     */
    emit(eventName, payload) {
        // Socket.IO v4 포맷: 42["eventName", payload]
        const strPayload = JSON.stringify([eventName, payload]);
        const message = `42${strPayload}`;
        
        this.log(`Emit (${eventName})`, payload);
        this.socket.send(message);
    }

    /**
     * 메시지 수신 핸들러
     * PING 자동 응답 및 이벤트 파싱 처리
     */
    listen(message) {
        // 1. PING 체크 ('2') -> PONG 전송 ('3')
        if (message.startsWith(PACKET_TYPES.PING)) {
            // this.log('Heartbeat', 'Ping received, sending Pong');
            this.socket.send(PACKET_TYPES.PONG);
            return null;
        }

        // 2. 메시지 패킷 처리 (42...)
        if (message.startsWith(PACKET_TYPES.MESSAGE + MESSAGE_TYPES.EVENT)) {
            const jsonStr = message.substring(2); // 접두어 '42' 제거
            try {
                const [event, data] = JSON.parse(jsonStr);
                
                // 서버가 보내는 에러 이벤트는 즉시 로그 출력
                if (event === 'error' || event.toLowerCase().includes('error')) {
                    this.error(`Server Error Event (${event})`, data);
                } else {
                    this.log(`Received (${event})`, data);
                }

                return { event, data };
            } catch (e) {
                this.error('Failed to parse socket message', message);
            }
        }
        
        // 3. 연결 확인 메시지 (0...) 등 기타 패킷
        if (CONFIG.DEBUG && !message.startsWith(PACKET_TYPES.PING)) {
           // this.log('Raw Message', message);
        }

        return null; 
    }
}