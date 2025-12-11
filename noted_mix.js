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
  // 쓰기(Write)가 포함되어 있으므로 부하가 꽤 있습니다.
  // 10명 -> 30명 -> 50명 순으로 테스트합니다.
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m',  target: 10 },

    { duration: '30s', target: 30 },
    { duration: '1m',  target: 30 },

    { duration: '30s', target: 50 },
    { duration: '1m',  target: 50 },

    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // 쓰기와 읽기가 섞여 있으므로 평균적인 기준을 잡습니다.
    http_req_duration: ['p(95)<800'], 
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // ==========================================
  // 1. 세션 시작 (회원가입 -> 로그인)
  // ==========================================
  const randomName = `MixUser_${randomString(5)}`;
  const email = `${randomString(8)}@mix.test`;
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
  // 2. 반복 구간 (생성 -> 조회 -> 생성 -> 조회 ...)
  // ==========================================
  
  // 한 유저가 5번 반복
  for (let i = 0; i < 5; i++) {
    group('Create & List Cycle', function () {
      
      // [Step A] 채팅방 생성 (Write)
      const roomPayload = JSON.stringify({
        name: `MixRoom_${randomString(5)}`
      });
      
      const createRes = http.post(`${BASE_URL}/api/rooms`, roomPayload, { headers: authHeaders });
      
      if (!check(createRes, { 'Create status 201': (r) => r.status === 201 })) {
        console.error(`❌ [Create Failed] Iteration: ${i} Status: ${createRes.status}`);
      }

      // 방금 만든 데이터가 DB에 반영되고, 유저가 목록으로 돌아가는 시간 시뮬레이션
      sleep(Math.random() * 1 + 0.5);

      // [Step B] 채팅방 목록 조회 (Read)
      const listRes = http.get(`${BASE_URL}/api/rooms?page=0&pageSize=10`, { headers: authHeaders });
      
      if (!check(listRes, { 
        'List status 200': (r) => r.status === 200,
        // 데이터가 배열인지 확인하는 체크 추가 (안전성 강화)
        'List is Array': (r) => r.json('data') && Array.isArray(r.json('data')) 
      })) {
        console.error(`❌ [List Failed] Iteration: ${i} Status: ${listRes.status}`);
      }
      
      // 다음 사이클 시작 전, 유저가 생각하거나 휴식하는 시간
      sleep(Math.random() * 1 + 1); 
    });
  }

  // ==========================================
  // 3. 세션 종료 (회원 탈퇴)
  // ==========================================
  const delRes = http.del(`${BASE_URL}/api/users/account`, null, { headers: authHeaders });

  if (!check(delRes, { 'Delete Account 200': (r) => r.status === 200 })) {
    console.error(`❌ [Delete Failed] Status: ${delRes.status}`);
  }
}