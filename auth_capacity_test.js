import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

const BASE_URL = 'https://api.goorm-ktb-010.goorm.team';

// [수정됨] 403 에러 방지를 위한 공통 헤더
const commonHeaders = {
  'Content-Type': 'application/json',
  'User-Agent': 'k6-load-test-agent/1.0',
};

export const options = {
  // 인증(Auth)은 CPU를 많이 쓰므로, 50명부터 시작해 서서히 늘려봅니다.
  stages: [
    // 1단계: 20명 (Warm-up)
    { duration: '30s', target: 20 },
    { duration: '1m',  target: 20 },

    // 2단계: 50명 (부하 진입)
    { duration: '30s', target: 50 },
    { duration: '2m',  target: 50 }, // 유지하며 CPU 추이 관찰

    // 3단계: 100명 (Stress 구간)
    { duration: '30s', target: 100 },
    { duration: '2m',  target: 100 },

    // 4단계: 150명 (한계 도전)
    { duration: '30s', target: 150 },
    { duration: '2m',  target: 150 },

    // 종료
    { duration: '30s', target: 0 },
  ],

  thresholds: {
    // 로그인/가입은 암호화 연산 때문에 일반 조회보다 느릴 수 있습니다.
    // p95 기준 1초(1000ms) 이내면 합격으로 설정
    http_req_duration: ['p(95)<1000'], 
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // 랜덤 유저 정보 생성
  const randomName = `AuthTest_${randomString(5)}`;
  const email = `${randomString(10)}@auth.test`;
  const password = 'Password123!';

  // ==========================================
  // 1. 회원가입 (Register)
  // ==========================================
  const registerPayload = JSON.stringify({
    name: randomName,
    email: email,
    password: password,
  });

  // [수정] commonHeaders 적용
  const registerRes = http.post(`${BASE_URL}/api/auth/register`, registerPayload, {
    headers: commonHeaders,
  });

  if (!check(registerRes, { 'Register status 201': (r) => r.status === 201 })) {
    let bodyPreview = registerRes.body ? registerRes.body.toString().substring(0, 100) : '';
    console.error(`❌ [Register Failed] Status: ${registerRes.status} | Body: ${bodyPreview}`);
    return; // 가입 실패 시 중단
  }

  // ==========================================
  // 2. 로그인 (Login) - 핵심 테스트 대상
  // ==========================================
  
  sleep(Math.random() * 1 + 0.5); 

  const loginPayload = JSON.stringify({
    email: email,
    password: password,
  });

  // [수정] commonHeaders 적용
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, {
    headers: commonHeaders,
  });

  const isLoginSuccess = check(loginRes, {
    'Login status 200': (r) => r.status === 200,
  });

  if (!isLoginSuccess) {
    console.error(`❌ [Login Failed] Status: ${loginRes.status}`);
    return;
  }

  // [수정] 안전한 토큰 추출 로직
  const body = loginRes.json();
  const token = body.token || (body.data && body.data.token);
  const sessionId = body.sessionId || (body.data && body.data.sessionId);

  // ==========================================
  // 3. 회원탈퇴 (Cleanup)
  // ==========================================
  if (token) {
    // [수정] commonHeaders에 인증 정보 추가
    const authHeaders = Object.assign({}, commonHeaders, {
      'Authorization': `Bearer ${token}`,
      'x-session-id': sessionId,
    });

    const deleteRes = http.del(`${BASE_URL}/api/users/account`, null, {
      headers: authHeaders,
    });

    if (!check(deleteRes, { 'Delete Account status 200': (r) => r.status === 200 })) {
        console.error(`❌ [Delete Failed] Status: ${deleteRes.status}`);
    }
  } else {
      console.error(`🚨 Token missing despite 200 OK!`);
  }

  sleep(Math.random() * 2 + 1);
}