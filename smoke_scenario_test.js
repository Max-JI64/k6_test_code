import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export const options = {
  // Scenario-based 설정
  scenarios: {
    // 1. 채팅방 목록 조회 유저
    chat_viewer: {
      executor: 'constant-vus',
      exec: 'chatFlow',
      vus: 1,
      duration: '30s',
    },
    // 2. 채팅방 생성 유저
    room_maker: {
      executor: 'constant-vus',
      exec: 'createRoomFlow',
      vus: 1,
      duration: '30s',
    },
    // 3. 프로필 관리 유저
    profile_manager: {
      executor: 'constant-vus',
      exec: 'profileFlow',
      vus: 1,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0.00'], // 에러율 0%여야 통과
    http_req_duration: ['p(95)<1000'], // 95% 요청이 1초 이내
  },
};

const BASE_URL = 'https://api.goorm-ktb-010.goorm.team';

// 공통 헤더 (브라우저 위장 및 JSON 설정)
const commonHeaders = {
  'Content-Type': 'application/json',
  'User-Agent': 'k6-load-test-agent/1.0',
};

// --- [수정됨] 공통 헬퍼 함수: 회원가입 -> 로그인 -> 토큰 발급 ---
function getAuthHeaders() {
  const randomName = `SmokeUser_${randomString(5)}`;
  const email = `${randomString(8)}@smoke.test`;
  const password = 'Password123!';

  // 1. 회원가입 요청
  const registerPayload = JSON.stringify({
    name: randomName,
    email: email,
    password: password
  });

  const regRes = http.post(`${BASE_URL}/api/auth/register`, registerPayload, { headers: commonHeaders });

  // 가입 실패 시 로그 출력 후 null 반환
  if (!check(regRes, { 'Register success': (r) => r.status === 201 })) {
    console.error(`❌ [Register Failed] Status: ${regRes.status} | Body: ${regRes.body}`);
    return null;
  }

  // 2. 로그인 요청 (토큰 발급을 위해 필수)
  const loginPayload = JSON.stringify({
    email: email,
    password: password
  });

  const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, { headers: commonHeaders });

  if (!check(loginRes, { 'Login success': (r) => r.status === 200 })) {
    console.error(`❌ [Login Failed] Status: ${loginRes.status} | Body: ${loginRes.body}`);
    return null;
  }
  
  // 3. 토큰 추출 및 헤더 생성
  const body = loginRes.json();
  const token = body.token || (body.data && body.data.token);
  const sessionId = body.sessionId || (body.data && body.data.sessionId);

  if (!token) {
    console.error(`🚨 Token missing in login response! Body: ${loginRes.body}`);
    return null;
  }

  return {
    headers: Object.assign({}, commonHeaders, {
      'Authorization': `Bearer ${token}`,
      'x-session-id': sessionId,
    }),
    userId: body.user ? body.user._id : null
  };
}

// --- 공통 헬퍼 함수: 계정 삭제 (Cleanup) ---
function deleteAccount(headers, scenarioName) {
  const res = http.del(`${BASE_URL}/api/users/account`, null, { headers: headers });
  if (!check(res, { [`${scenarioName}: Delete Account 200`]: (r) => r.status === 200 })) {
    console.error(`❌ [${scenarioName} Cleanup Failed] Status: ${res.status}, Body: ${res.body}`);
  }
}

// --- 시나리오 1: 채팅방 목록 조회 흐름 ---
export function chatFlow() {
  const auth = getAuthHeaders();
  if (!auth) return;

  // 채팅방 목록 조회
  const res = http.get(`${BASE_URL}/api/rooms?page=0&pageSize=10`, { headers: auth.headers });
  
  if (!check(res, { 'ChatFlow: Get Rooms 200': (r) => r.status === 200 })) {
    console.error(`❌ [ChatFlow Error] Status: ${res.status}, Body: ${res.body}`);
  }

  // 회원 탈퇴
  deleteAccount(auth.headers, 'ChatFlow');
  sleep(1);
}

// --- 시나리오 2: 채팅방 생성 흐름 ---
export function createRoomFlow() {
  const auth = getAuthHeaders();
  if (!auth) return;

  // 채팅방 생성
  const payload = JSON.stringify({ name: `SmokeRoom_${randomString(5)}` });
  const res = http.post(`${BASE_URL}/api/rooms`, payload, { headers: auth.headers });
  
  if (!check(res, { 'RoomMaker: Create Room 201': (r) => r.status === 201 })) {
    console.error(`❌ [RoomMaker Error] Status: ${res.status}, Body: ${res.body}`);
  }

  // 회원 탈퇴
  deleteAccount(auth.headers, 'RoomMaker');
  sleep(2);
}

// --- 시나리오 3: 프로필 관리 흐름 ---
export function profileFlow() {
  const auth = getAuthHeaders();
  if (!auth) return;

  // 내 프로필 조회
  const res = http.get(`${BASE_URL}/api/users/profile`, { headers: auth.headers });
  if (!check(res, { 'ProfileMgr: Get Profile 200': (r) => r.status === 200 })) {
    console.error(`❌ [ProfileMgr Get Error] Status: ${res.status}, Body: ${res.body}`);
  }

  // 내 프로필 수정
  const updatePayload = JSON.stringify({ name: `Updated_${randomString(5)}` });
  const updateRes = http.put(`${BASE_URL}/api/users/profile`, updatePayload, { headers: auth.headers });
  
  if (!check(updateRes, { 'ProfileMgr: Update Profile 200': (r) => r.status === 200 })) {
    console.error(`❌ [ProfileMgr Update Error] Status: ${updateRes.status}, Body: ${updateRes.body}`);
  }

  // 회원 탈퇴
  deleteAccount(auth.headers, 'ProfileMgr');
  sleep(1);
}