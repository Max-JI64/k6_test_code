import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

const BASE_URL = 'https://api.goorm-ktb-010.goorm.team';

// [수정됨] 403 에러 방지를 위한 공통 헤더
const commonHeaders = {
  'Content-Type': 'application/json',
  'User-Agent': 'k6-load-test-agent/1.0',
};

export const options = {
  // 쓰기(Write) 작업은 DB 부하가 훨씬 큽니다.
  // 조회 테스트(200명)보다 적은 인원(50명)으로 시작하는 것이 안전합니다.
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m',  target: 10 },  // 10명이 동시에 방 생성 중

    { duration: '30s', target: 30 },
    { duration: '1m',  target: 30 },  // 30명으로 증가

    { duration: '30s', target: 50 },
    { duration: '1m',  target: 50 },  // 50명 (최대 부하)

    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // 쓰기 작업은 조회보다 느릴 수밖에 없습니다. 기준을 500ms~800ms로 잡습니다.
    http_req_duration: ['p(95)<800'], 
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // ==========================================
  // 1. 세션 시작 (회원가입 -> 로그인)
  // ==========================================
  const randomName = `Maker_${randomString(5)}`;
  const email = `${randomString(10)}@maker.test`;
  const password = 'Password123!';
  
  // 1-1. 회원가입
  const registerRes = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({
    name: randomName, email, password: password
  }), { headers: commonHeaders });

  if (!check(registerRes, { 'Register success': (r) => r.status === 201 })) {
    let bodyPreview = registerRes.body ? registerRes.body.toString().substring(0, 100) : '';
    console.error(`❌ [Register Failed] Status: ${registerRes.status} | Body: ${bodyPreview}`);
    return;
  }

  // 1-2. 로그인 (토큰 획득을 위해 추가됨)
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email, password
  }), { headers: commonHeaders });

  if (!check(loginRes, { 'Login success': (r) => r.status === 200 })) {
    console.error(`❌ [Login Failed] Status: ${loginRes.status}`);
    return;
  }

  const body = loginRes.json();
  const token = body.token || (body.data && body.data.token);
  const sessionId = body.sessionId || (body.data && body.data.sessionId);

  if (!token) {
    console.error(`🚨 Token missing!`);
    return;
  }

  // 인증 헤더 생성
  const authHeaders = Object.assign({}, commonHeaders, {
    'Authorization': `Bearer ${token}`,
    'x-session-id': sessionId,
  });

  // ==========================================
  // 2. 집중 테스트 구간 (방 생성 - N회 반복)
  // ==========================================
  
  group('Repeat Create Room', function () {
    // 한 유저가 방을 10개씩 만들고 나감
    // (50명 VU * 10개 = 순간적으로 500개의 방 생성 요청 발생)
    for (let i = 0; i < 10; i++) {
      const roomPayload = JSON.stringify({
        name: `StressTest_Room_${randomString(5)}`
        // password: "1234" 
      });

      const createRes = http.post(`${BASE_URL}/api/rooms`, roomPayload, { headers: authHeaders });

      if (!check(createRes, { 'Create Room 201': (r) => r.status === 201 })) {
        console.error(`❌ [Create Room Failed] Iteration: ${i} Status: ${createRes.status}`);
      }

      // 쓰기 작업은 DB 락을 유발하므로, 너무 빠르지 않게 1~2초 사이의 랜덤 텀을 줍니다.
      sleep(Math.random() * 1 + 1); 
    }
  });

  // ==========================================
  // 3. 세션 종료 (회원 탈퇴)
  // ==========================================
  // 유저는 삭제하지만, 위에서 만든 방들은 DB에 남게 됩니다. (API 제한)
  const delRes = http.del(`${BASE_URL}/api/users/account`, null, { headers: authHeaders });
  
  if (!check(delRes, { 'Delete Account 200': (r) => r.status === 200 })) {
     console.error(`❌ [Delete Failed] Status: ${delRes.status}`);
  }
}