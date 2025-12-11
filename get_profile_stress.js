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
  // 프로필 조회는 데이터가 작고 로직이 단순하므로, 
  // 채팅방 목록 조회(Get Rooms)보다 더 많은 동시 접속자를 처리할 수 있어야 정상입니다.
  stages: [
    // 1단계: 50명
    { duration: '30s', target: 50 },
    { duration: '1m',  target: 50 },

    // 2단계: 100명
    { duration: '30s', target: 100 },
    { duration: '1m',  target: 100 },

    // 3단계: 200명
    { duration: '30s', target: 200 },
    { duration: '1m',  target: 200 },

    // 4단계: 300명 (가벼운 API이므로 좀 더 올려봅니다)
    { duration: '30s', target: 300 },
    { duration: '1m',  target: 300 },

    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // 아주 빠른 응답이 기대되므로 p95 기준 200ms 이하로 잡습니다.
    http_req_duration: ['p(95)<200'], 
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // ==========================================
  // 1. 세션 시작 (회원가입 -> 로그인)
  // ==========================================
  const randomName = `ProfileUser_${randomString(5)}`;
  const email = `${randomString(10)}@profile.test`;
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
  // 2. 집중 테스트 구간 (프로필 조회 - 20회 반복)
  // ==========================================
  
  group('Repeat Get Profile', function () {
    for (let i = 0; i < 20; i++) {
      const profileRes = http.get(`${BASE_URL}/api/users/profile`, { headers: authHeaders });

      if (!check(profileRes, {
        'Get Profile 200': (r) => r.status === 200,
        'Correct Email': (r) => r.json('user.email') === email, // 이메일 검증
        'Success True': (r) => r.json('success') === true,
      })) {
         console.error(`❌ [Get Profile Failed] Iteration: ${i} Status: ${profileRes.status}`);
      }

      // 단순 API지만 너무 기계적인 호출을 막기 위해 랜덤성 부여
      sleep(Math.random() * 1 + 0.5); 
    }
  });

  // ==========================================
  // 3. 세션 종료 (회원 탈퇴)
  // ==========================================
  const delRes = http.del(`${BASE_URL}/api/users/account`, null, { headers: authHeaders });
  
  if (!check(delRes, { 'Delete Account 200': (r) => r.status === 200 })) {
    console.error(`❌ [Delete Failed] Status: ${delRes.status}`);
  }
}