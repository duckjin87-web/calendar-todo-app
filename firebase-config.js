/* ============================================================
   Firebase 설정 (기기 간 동기화용)

   ▸ 아래 값을 본인 Firebase 프로젝트의 "웹 앱" config 값으로 교체하세요.
   ▸ 값을 비워두면(현재 상태) 앱은 '이 기기에만 저장'(로컬) 모드로 동작합니다.
   ▸ 설정 방법은 README.md 의 "기기 간 동기화(Firebase)" 항목 참고.

   여기 들어가는 값들은 웹앱에 공개되는 값으로 '비밀키'가 아닙니다.
   실제 보안은 Firestore 보안 규칙(firestore.rules)으로 합니다.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
