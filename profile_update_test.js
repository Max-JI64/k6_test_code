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
  // 프로필 수정(UPDATE)은 조회(READ)보다 DB 락(Lock)이나 인덱스 갱신 등으로 인해 비용이 높습니다.
  stages: [
    // 1단계: 50명 (Warm-up)
    { duration: '30s', target: 50 },
    { duration: '1m',  target: 50 },

    // 2단계: 100명 (Load)
    { duration: '30s', target: 100 },
    { duration: '1m',  target: 100 },

    // 3단계: 200명 (High Load)
    { duration: '30s', target: 200 },
    { duration: '1m',  target: 200 },

    // 4단계: 300명 (Stress)
    { duration: '30s', target: 300 },
    { duration: '1m',  target: 300 },

    // 종료
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Write 작업이므로 Read(200ms)보다 조금 더 여유를 둡니다 (500ms).
    http_req_duration: ['p(95)<500'], 
    http_req_failed: ['rate<0.01'], // 에러율 1% 미만
  },
};

export default function () {
  // ==========================================
  // 1. 세션 시작 (회원가입 -> 로그인)
  // ==========================================
  const randomId = randomString(5);
  const initialName = `User_${randomId}`;
  const email = `${randomString(10)}@update.test`;
  const password = 'Password123!';
  
  // 1-1. 회원가입
  const registerPayload = JSON.stringify({
    name: initialName, 
    email: email, 
    password: password
  });

  const registerRes = http.post(`${BASE_URL}/api/auth/register`, registerPayload, { 
    headers: commonHeaders 
  });

  if (!check(registerRes, { 'Register success': (r) => r.status === 201 })) {
    let bodyPreview = registerRes.body ? registerRes.body.toString().substring(0, 100) : '';
    console.error(`❌ [Register Failed] Status: ${registerRes.status} | Body: ${bodyPreview}`);
    return;
  }

  // 1-2. 로그인 (토큰 획득을 위해 필수)
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
  // 2. 집중 테스트 구간 (프로필 수정 - 20회 반복)
  // ==========================================
  
  group('Repeat Update Profile', function () {
    // 한 유저가 20번 이름을 변경한다고 가정
    for (let i = 0; i < 20; i++) {
      
      // 매번 다른 이름 생성 (DB 변경 확인용)
      const newName = `Updated_${randomString(5)}`;
      const updatePayload = JSON.stringify({ name: newName });

      const updateRes = http.put(`${BASE_URL}/api/users/profile`, updatePayload, { headers: authHeaders });

      // [Check] 수정 요청 검증
      const isSuccess = check(updateRes, {
        'Update Profile 200': (r) => r.status === 200,
        'Success Field True': (r) => r.json('success') === true,
        'Name Updated Correctly': (r) => r.json('user.name') === newName,
      });

      // [Debug] 실패 시 로그 출력
      if (!isSuccess) {
         console.error(`❌ [Update Failed] Iteration: ${i} | User: ${email} | Status: ${updateRes.status}`);
      }

      // [Sleep] 랜덤 대기 (0.5초 ~ 1.5초)
      sleep(Math.random() * 1 + 0.5); 
    }
  });

  // ==========================================
  // 3. 세션 종료 (회원 탈퇴)
  // ==========================================
  const delRes = http.del(`${BASE_URL}/api/users/account`, null, { headers: authHeaders });
  
  if (!check(delRes, { 'Delete Account 200': (r) => r.status === 200 })) {
    console.error(`❌ [Delete Failed] User: ${email} | Status: ${delRes.status}`);
  }
}