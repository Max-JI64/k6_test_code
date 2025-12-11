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
  // 조회(Read) 위주이므로 처리량이 높을 것입니다. VUs를 넉넉히 잡습니다.
  stages: [
    { duration: '30s', target: 50 },  // 50명 접속
    { duration: '1m',  target: 50 },  // 유지
    
    { duration: '30s', target: 100 }, // 100명 접속
    { duration: '1m',  target: 100 }, // 유지

    { duration: '30s', target: 200 }, // 200명 접속
    { duration: '1m',  target: 200 }, // 유지

    { duration: '30s', target: 0 },   // 종료
  ],
  thresholds: {
    // "GET /api/rooms" 요청에 대한 기준
    // 쓰기 작업이 섞여있지 않으므로 좀 더 타이트하게 잡습니다 (300ms)
    http_req_duration: ['p(95)<300'], 
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // ==========================================
  // 1. 세션 시작 (회원가입 -> 로그인)
  // ==========================================
  const randomName = `Viewer_${randomString(5)}`;
  const email = `${randomString(10)}@viewer.test`;
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
  // 2. 집중 테스트 구간 (목록 조회 - N회 반복)
  // ==========================================
  // 여기서 반복문을 돌려서 "가입/탈퇴" 비율을 줄이고 "조회" 비율을 높입니다.
  
  group('Repeat Get Rooms', function () {
    for (let i = 0; i < 20; i++) {
      const listRes = http.get(`${BASE_URL}/api/rooms?page=0&pageSize=20`, { headers: authHeaders });

      if (!check(listRes, { 'Get Rooms 200': (r) => r.status === 200 })) {
        console.error(`❌ [Get Rooms Failed] Iteration: ${i} Status: ${listRes.status}`);
      }

      // 사람이 새로고침 하는 것처럼 불규칙적인 텀 부여
      sleep(Math.random() * 1 + 0.5); 
    }
  });

  // ==========================================
  // 3. 세션 종료 (회원 탈퇴 - 1회)
  // ==========================================
  const delRes = http.del(`${BASE_URL}/api/users/account`, null, { headers: authHeaders });
  
  if (!check(delRes, { 'Delete Account 200': (r) => r.status === 200 })) {
    console.error(`❌ [Delete Failed] Status: ${delRes.status}`);
  }

  // 다음 VU 실행 전 약간의 랜덤 대기 (1~2초)
  sleep(Math.random() * 1 + 1);
}