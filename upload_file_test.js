import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// ==============================================================================
// 1. 테스트 환경 설정 (Options & Variables)
// ==============================================================================

export const options = {
    stages: [
        { duration: '10s', target: 5 },  // Warm-up
        { duration: '30s', target: 10 }, // Load
        { duration: '5s', target: 0 },   // Cooldown
    ],
    thresholds: {
        http_req_duration: ['p(95)<3000'], // 업로드는 시간이 좀 걸리므로 3초
        http_req_failed: ['rate<0.05'],
    },
};

const FILE_SIZE = 500 * 1024; // 500KB
const DUMMY_FILE_CONTENT = 'x'.repeat(FILE_SIZE);

const MIN_SLEEP = 0.5;
const MAX_SLEEP = 2.0;

const BASE_URL = 'https://api.goorm-ktb-010.goorm.team';

// [수정됨] 403 에러 방지용 User-Agent (JSON 요청용)
const jsonHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'k6-load-test-agent/1.0',
};

// ==============================================================================
// 2. Setup: 테스트 시작 전 1회 실행 (회원가입 -> 로그인 -> 토큰 공유)
// ==============================================================================
export function setup() {
    console.log(`🚀 [Setup] 테스트 준비: 회원가입 및 로그인 진행...`);

    const randomId = randomString(6);
    const userEmail = `uploader_${randomId}@test.com`;
    const password = 'Password123!';
    
    // 2-1. 회원가입
    const regPayload = JSON.stringify({
        name: `Tester_${randomId}`,
        email: userEmail,
        password: password,
    });

    const regRes = http.post(`${BASE_URL}/api/auth/register`, regPayload, { headers: jsonHeaders });

    if (regRes.status !== 201) {
        console.error(`❌ [Setup Error] 회원가입 실패. Status: ${regRes.status}`);
        console.error(`   Body: ${regRes.body}`);
        throw new Error('Setup failed: Register');
    }

    // 2-2. 로그인 (토큰 획득을 위해 필수 추가됨)
    const loginPayload = JSON.stringify({
        email: userEmail,
        password: password,
    });

    const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, { headers: jsonHeaders });

    if (loginRes.status !== 200) {
        console.error(`❌ [Setup Error] 로그인 실패. Status: ${loginRes.status}`);
        throw new Error('Setup failed: Login');
    }

    console.log(`✅ [Setup] User(${userEmail}) 토큰 획득 성공.`);

    const body = loginRes.json();
    
    // 이 반환값(토큰)은 모든 VU들이 'data' 파라미터로 공유받습니다.
    return {
        token: body.token || (body.data && body.data.token),
        sessionId: body.sessionId || (body.data && body.data.sessionId),
        email: userEmail
    };
}

// ==============================================================================
// 3. VU Logic: 가상 유저 시나리오 (반복 실행)
// ==============================================================================
export default function (data) {
    const { token, sessionId, email } = data;

    if (!token) {
        console.error(`🚨 Token is missing in VU execution!`);
        return;
    }

    // 3-1. 파일 객체 준비
    const file = http.file(DUMMY_FILE_CONTENT, `dummy_${randomString(5)}.png`, 'image/png');

    const payload = {
        file: file,
    };

    // [중요] 업로드 헤더 설정
    // 1. Authorization 포함
    // 2. User-Agent 포함 (403 방지)
    // 3. Content-Type은 절대 설정하지 않음 (k6가 multipart/form-data boundary 자동 생성)
    const params = {
        headers: {
            'Authorization': `Bearer ${token}`,
            'x-session-id': sessionId,
            'User-Agent': 'k6-load-test-agent/1.0', 
        },
        timeout: '60s', 
    };

    // 3-2. API 요청
    const res = http.post(`${BASE_URL}/api/files/upload`, payload, params);

    // 3-3. 결과 검증
    const isSuccess = check(res, {
        'Upload success (200)': (r) => r.status === 200,
    });

    // 3-4. 에러 로그
    if (!isSuccess) {
        // Body가 HTML이거나 너무 길 수 있으므로 예외처리
        let errMsg = res.body;
        if (errMsg && errMsg.length > 200) errMsg = errMsg.substring(0, 200) + '...';
        
        console.error(`❌ [Upload Fail] Status: ${res.status} | Body: ${errMsg}`);
    }

    // 3-5. 랜덤 Sleep
    const randomSleepTime = Math.random() * (MAX_SLEEP - MIN_SLEEP) + MIN_SLEEP;
    sleep(randomSleepTime);
}

// (선택 사항) Teardown: 테스트가 모두 끝난 후 1회 실행되어 계정을 정리
export function teardown(data) {
    // 계정 삭제가 필요하다면 여기서 수행 (단, 토큰이 필요함)
    // setup에서 리턴한 data를 teardown에서도 받을 수 있습니다.
    if (data && data.token) {
        const headers = {
            'Authorization': `Bearer ${data.token}`,
            'x-session-id': data.sessionId,
            'User-Agent': 'k6-load-test-agent/1.0',
        };
        http.del(`${BASE_URL}/api/users/account`, null, { headers: headers });
        console.log('🧹 [Teardown] 테스트 계정 삭제 완료.');
    }
}