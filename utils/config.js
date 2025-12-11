// utils/config.js

export const CONFIG = {
    // 실제 서버 주소 (wss 프로토콜)
    BASE_URL: 'wss://chat.goorm-ktb-010.goorm.team/socket.io/?EIO=4&transport=websocket',
    
    // 테스트용 채팅방 ID
    TEST_ROOM_ID: '507f1f77bcf86cd799439011',

    // 디버그 모드 활성화 여부
    // 실행 시 명령어 옵션으로 덮어쓰기 가능: k6 run -e DEBUG=true ...
    DEBUG: __ENV.DEBUG === 'true',
};