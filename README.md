🧤 스마트 장갑 Server 코드

스마트 장갑에서 전송된 데이터를 저장하고 보호자 앱/웹에 제공하는 서버 코드입니다.
(Node.js + MySQL + Firebase 기반)

⚙️ 주요 기능

사용자/보호자 회원가입 및 로그인

보호자 ↔ 사용자 계정 연동

장갑 상태(BLE 연결, 손가락 굽힘 상태) 저장

GPS 위치 데이터 저장 및 조회

이상행동/배터리 알림 → Firebase FCM 전송

RESTful API 제공 (Flutter 앱/웹 연동)

📂 프로젝트 구조
📦 server_midas
 ┣ 📜 server.js          # 메인 서버 실행 파일
 ┣ 📂 routes/            # API 라우터
 ┣ 📂 models/            # MySQL 테이블 모델
 ┣ 📂 config/            # DB/Firebase 설정
 ┗ 📜 package.json       # npm 패키지 관리

🗄️ 데이터베이스 구조

user : 사용자/보호자 계정 정보

guardian_link : 보호자-사용자 연결

event : 이벤트 로그 (알림, 상태 변경 등)

motion_data : 손가락/모션 센서 데이터

🌐 서버 접근

외부망 (도메인 연결)

https://midas.p-e.kr

🚀 실행 방법
1. 의존성 설치
npm install

2. 개발 실행
node server.js

3. PM2로 백그라운드 실행 (라즈베리Pi)
# 서버 실행
pm2 start server.js --name midas-server

# 상태 확인
pm2 status

# 로그 확인
pm2 logs midas-server

# 재시작 / 중지
pm2 restart midas-server
pm2 stop midas-server

# 부팅 시 자동 실행 등록
pm2 startup
pm2 save

🔔 기타

라즈베리 서버 환경: Raspberry Pi 5 + DietPi + Node.js + MySQL

알림: Firebase Admin SDK 연동 (FCM 전송)

보호자 앱/웹에서 API 호출을 통해 실시간 위치, 장갑 상태, 이벤트 내역 조회 가능

📡 API 엔드포인트 목록
🧑 사용자/보호자 계정
회원가입
POST /api/register

Request

{
  "login_id": "user1",
  "password": "1234",
  "role": "user"
}


Response

{ "success": true, "message": "회원가입 성공" }

로그인
POST /api/login


Request

{
  "login_id": "user1",
  "password": "1234"
}


Response

{
  "success": true,
  "user": {
    "user_id": 31,
    "role": "user"
  }
}

🔗 보호자-사용자 연결
보호자 연동 코드 발급
POST /api/link-code


Response

{ "code": "ABCD12" }

사용자 연동 처리
POST /api/link-user


Request

{
  "user_id": 31,
  "code": "ABCD12"
}


Response

{ "success": true, "message": "연동 완료" }

📍 위치 관련
위치 저장
POST /api/position


Request

{
  "user_id": 31,
  "latitude": 37.5665,
  "longitude": 126.9780,
  "timestamp": "2025-09-24T12:30:00Z"
}


Response

{ "success": true, "message": "위치 저장 완료" }

보호자가 연동한 사용자 위치 조회
GET /api/guardian/:guardianId/users-location


Response

[
  {
    "user_id": 31,
    "latitude": 37.5665,
    "longitude": 126.9780,
    "timestamp": "2025-09-24T12:30:00Z"
  }
]

🖐️ 장갑 상태
BLE 상태 저장
POST /api/glove-status


Request

{
  "user_id": 31,
  "glove_connected": true
}


Response

{ "success": true }

모션 데이터 저장
POST /api/motion


Request

{
  "user_id": 31,
  "finger_data": "F1:OPEN,F2:CLOSED,F3:OPEN",
  "status_code": 2
}


Response

{ "success": true, "message": "모션 데이터 저장 완료" }

📢 알림 (FCM)
테스트 푸시 알림
POST /api/send-test-notification


Response

{ "success": true, "message": "테스트 알림 전송됨" }

배터리 경고 알림
POST /api/send-battery-alert


Request

{
  "user_id": 31,
  "level": 15
}


Response

{ "success": true, "message": "배터리 경고 전송됨" }

이상행동 알림
POST /api/send-motion-alert


Request

{
  "user_id": 31,
  "event": "이상 행동 감지됨"
}


Response

{ "success": true, "message": "이상행동 알림 전송됨" }

📝 이벤트 로그
이벤트 전체 저장
POST /api/full-event


Request

{
  "user_id": 31,
  "type": "motion",
  "description": "F2 CLOSED → 위치 전송"
}


Response

{ "success": true }

최신 이벤트 조회
GET /api/event/latest/:userId


Response

{
  "event_id": 101,
  "user_id": 31,
  "type": "motion",
  "description": "F2 CLOSED → 위치 전송",
  "timestamp": "2025-09-24T12:30:00Z"
}
