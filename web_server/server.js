const express = require('express');
const app = express();
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mysql = require('mysql2');
const methodOverride = require('method-override'); // ✅ 추가

const PORT = ;

// 미들웨어
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// ✅ method-override 미들웨어 추가 (PUT, DELETE 요청을 위해 필수)
app.use(methodOverride('_method'));


app.use(session({
  secret: 'midas_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1시간
}));
// 모든 EJS 템플릿에서 사용할 수 있는 날짜 포맷팅 함수 정의
app.locals.formatDate = date => {
  const d = new Date(date);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

// DB 연결
const connection = mysql.createConnection({
  host: '',
  user: '',
  password: '',
  database: '',
  port: ,
});
connection.connect();

function isLoggedIn(req, res, next) {
  if (req.session && req.session.loginUserName) return next();
  res.redirect('/login');
}

// 메인 페이지
// app.get('/', (req, res) => {
//   res.render('midas', {
//     loginUserName: req.session.loginUserName,
//     loginUserId: req.session.loginUserId,
//     role: req.session.role  // 이 줄 추가
//   });
// });
// 회원가입 페이지
app.get('/join', (req, res) => {
  res.render('join');
});

// 회원가입 처리
app.post('/user', (req, res) => {
  console.log('✅ 회원가입 요청 수신됨');
  console.log('req.body:', req.body);

  const { userId, pw } = req.body;
  let role = req.body.role;

  // ✅ 'guardian'을 'guad'로 축약해서 저장
  if (role === 'guardian') {
    role = 'guad';
  }

  bcrypt.hash(pw, 10, (err, hash) => {
    if (err) {
      console.error('비밀번호 해시 실패:', err);
      return res.send('서버 오류');
    }

    connection.query(
      'INSERT INTO user (login_id, password, role) VALUES (?, ?, ?)',
      [userId, hash, role],
      (err, result) => {
        if (err) {
          console.error('회원가입 실패:', err);
          return res.send('회원가입에 실패했습니다.');
        }
        res.redirect('/login');
      }
    );
  });
});

// 로그인 페이지
app.get('/login', (req, res) => {
  res.render('login');
});

// 로그인 처리
// 수정된 코드: role 조건 제거
app.post('/login', (req, res) => {
  const { userId, pw } = req.body;

  connection.query(
    'SELECT * FROM user WHERE login_id = ?', // user_id → login_id로 수정도 반영
    [userId],
    (err, result) => {
      if (err) {
        console.error('로그인 오류:', err);
        return res.send('서버 오류');
      }

      if (result.length === 1) {
        const user = result[0];

        if (bcrypt.compareSync(pw, user.password)) {
          req.session.userId = user.user_id;
          req.session.loginUserName = user.login_id;
          req.session.loginUserId = user.login_id;
          req.session.role = user.role;  // DB에서 가져온 role을 세션에 저장
          console.log('✅ 로그인 성공 → 세션 정보:', req.session);
          res.redirect('/');
        } else {
          res.send('비밀번호가 틀렸습니다.');
        }
      } else {
        res.send('아이디가 존재하지 않습니다.');
      }
    }
  );
});


// 로그아웃
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// 더 간단한 기본 라우팅
app.get('/', (req, res) => {
  res.render('midas', {
    loginUserName: req.session.loginUserName,
    loginUserId: req.session.loginUserId,
    role: req.session.role
  });
});


// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 MIDAS 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});

//about page 
app.get('/about', (req, res) => {
  if (!req.session.loginUserName) return res.redirect('/login');
  const loginUserName = req.session?.loginUserName;  // 로그인 세션에서 이름 가져오기
  res.render('about', { loginUserName });  // ✅ 변수 전달
});

//location page
app.get('/location', (req, res) => {
  if (!req.session.loginUserName) return res.redirect('/login');
  // event 테이블에서 가장 최근 위치 1개조회
  const sql = `
    SELECT latitude, longitude 
    FROM event 
    ORDER BY timestamp DESC 
    LIMIT 1
  `;

  connection.query(sql, (err, result) => {
    let lat = null;
    let lng = null;

    if (!err && result.length > 0) {
      lat = result[0].latitude;
      lng = result[0].longitude;
    }
    console.log('✅ [서버] DB에서 가져온 좌표 →', { lat, lng });

    // 렌더링 하면서  세션에 저장된 로그인 이름과 위도/경도 전달 
    res.render('location', {
      loginUserName: req.session.loginUserName,
      lat,
      lng
    });
  });
});

// ① 게시판 목록 페이지
app.get('/board', isLoggedIn, (req, res) => {
  const sql = `
    SELECT 
    b.id,
    b.title,
    CONVERT_TZ(b.created_at, '+00:00', '+09:00') AS created_at,        u.login_id AS user_id
    FROM board AS b
    JOIN user  AS u
    ON b.user_id = u.user_id
    ORDER BY b.created_at DESC
  `;
  connection.query(sql, (err, contents) => {
    if (err) {
      console.error(err);
      return res.send('게시글 조회 오류');
    }
    res.render('board', {
      title: '게시판',
      contents,
      loginUserId:   req.session.loginUserId,
      loginUserName: req.session.loginUserName
    });
  });
});

// ② 글 작성 폼
app.get('/board/new', isLoggedIn, (req, res) => {
  res.render('form', { content: {},
  loginUserName: req.session.loginUserName });
});

// ③ 글 등록
app.post('/board', isLoggedIn, (req, res) => {
  const { title, content } = req.body;
  const sql = `INSERT INTO board (user_id, title, content) VALUES (?, ?, ?)`;
  connection.query(sql,
    [req.session.userId, title, content],
    err => {
      if (err) {
        console.error(err);
        return res.send('글 작성 오류');
      }
      res.redirect('/board');
    });
});

// ④ 글 상세보기 (댓글 포함) - ✅ 중복 제거하고 하나로 통합
app.get('/board/:id', isLoggedIn, (req, res) => {
  const postId = req.params.id;
  
  // 1) 게시글 정보 조회
  const postSql = `
    SELECT 
      b.id         AS no,
      b.title,
      b.content,
      b.created_at,
      u.login_id   AS name,
      b.user_id
    FROM board b
    JOIN user  u ON b.user_id = u.user_id
    WHERE b.id = ?
  `;
  
  connection.query(postSql, [postId], (err, postRows) => {
    if (err || postRows.length === 0) return res.redirect('/board');
    const content = postRows[0];

    // 2) 댓글 목록 조회
     const cmtSql = `
      SELECT 
        c.id,
        c.content,
        c.created_at,
        c.user_id,
        u.login_id AS commenter
      FROM comments c
      JOIN user     u ON c.user_id = u.user_id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `;
    
    connection.query(cmtSql, [postId], (err2, comments) => {
      if (err2) {
        // 'comments' 테이블이 없으면 여기서 다시 오류가 발생합니다.
        console.error(err2);
        return res.send('댓글 조회 오류');
      }
      
      // 3) 게시글과 댓글 정보를 함께 뷰에 전달
      res.render('post', {
        content,
        comments,
        loginUserId:   req.session.loginUserId,
        loginUserName: req.session.loginUserName
      });
    });
  });
});


// ⑤ 글 수정 폼
app.get('/board/:id/edit', isLoggedIn, (req, res) => {
  const postId = req.params.id;
  
  connection.query(
    'SELECT * FROM board WHERE id = ?', [postId],
    (err, rows) => {
      if (err || rows.length === 0) return res.redirect('/board');
      
      const post = rows[0];
      
      // ✅ 권한 검증: 작성자만 수정 가능
      if (post.user_id !== req.session.userId) {
        return res.status(403).send('권한이 없습니다.');
      }
      
      // ✅ form.ejs에서 사용할 수 있도록 no 필드 추가
      post.no = post.id;
      
      res.render('form', { 
        content: post,
        loginUserName: req.session.loginUserName,
        loginUserId: req.session.loginUserId
      });
    }
  );
});
// ⑥ 글 수정 처리 (PUT) - ✅ 새로 추가
app.put('/board/:id', isLoggedIn, (req, res) => {
  const postId = req.params.id;
  const { title, content } = req.body;
  
  // 권한 검증
  connection.query(
    'SELECT user_id FROM board WHERE id = ?', [postId],
    (err, rows) => {
      if (err || rows.length === 0) {
        return res.status(404).send('게시글을 찾을 수 없습니다.');
      }
      
      if (rows[0].user_id !== req.session.userId) {
        return res.status(403).send('권한이 없습니다.');
      }
      
      // 수정 실행
      connection.query(
        'UPDATE board SET title = ?, content = ? WHERE id = ?',
        [title, content, postId],
        err => {
          if (err) {
            console.error(err);
            return res.send('글 수정 오류');
          }
          res.redirect(`/board/${postId}`);
        }
      );
    }
  );
});
// ⑦ 글 삭제 (DELETE) - ✅ 새로 추가
app.delete('/board/:id', isLoggedIn, (req, res) => {
  const postId = req.params.id;
  
  // 권한 검증
  connection.query(
    'SELECT user_id FROM board WHERE id = ?', [postId],
    (err, rows) => {
      if (err || rows.length === 0) {
        return res.status(404).send('게시글을 찾을 수 없습니다.');
      }
      
      if (rows[0].user_id !== req.session.userId) {
        return res.status(403).send('권한이 없습니다.');
      }
      
      // 관련 댓글 먼저 삭제
      connection.query(
        'DELETE FROM comments WHERE post_id = ?', [postId],
        (err1) => {
          if (err1) {
            console.error(err1);
            return res.send('댓글 삭제 오류');
          }
          
          // 게시글 삭제
          connection.query(
            'DELETE FROM board WHERE id = ?', [postId],
            (err2) => {
              if (err2) {
                console.error(err2);
                return res.send('게시글 삭제 오류');
              }
              res.redirect('/board');
            }
          );
        }
      );
    }
  );
});
// ===== 댓글 라우터 =====

// 댓글 작성 처리
app.post('/comments', isLoggedIn, (req, res) => {
  const { postNo, content } = req.body;
  const sql = `
    INSERT INTO comments (post_id, user_id, content)
    VALUES (?, ?, ?)
  `;
  connection.query(
    sql,
    [postNo, req.session.userId, content], // ✅ 세션 변수명 통일
    err => {
      if (err) {
        console.error(err);
        return res.send('댓글 작성 오류');
      }
      res.redirect(`/board/${postNo}`);
    }
  );
});

// ✅ 댓글 삭제 (DELETE) - 새로 추가
app.delete('/comments/:id', isLoggedIn, (req, res) => {
  const commentId = req.params.id;
  
  // 댓글 작성자 확인 및 post_id 조회
  connection.query(
    'SELECT user_id, post_id FROM comments WHERE id = ?', [commentId],
    (err, rows) => {
      if (err || rows.length === 0) {
        return res.status(404).send('댓글을 찾을 수 없습니다.');
      }
      
      const comment = rows[0];
      
      if (comment.user_id !== req.session.userId) {
        return res.status(403).send('권한이 없습니다.');
      }
      
      const postId = comment.post_id;
      
      // 댓글 삭제
      connection.query(
        'DELETE FROM comments WHERE id = ?', [commentId],
        (err2) => {
          if (err2) {
            console.error(err2);
            return res.send('댓글 삭제 오류');
          }
          res.redirect(`/board/${postId}`);
        }
      );
    }
  );
});

// mypage 라우트
// server.js의 /mypage 라우트 수정
app.get('/mypage', isLoggedIn, (req, res) => {
  const sql = `
    SELECT latitude, longitude, timestamp
    FROM event
    ORDER BY timestamp DESC
    LIMIT 5
  `;
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('최근 위치 조회 오류:', err);
      return res.send('최근 위치를 불러오는 데 실패했습니다.');
    }
    
    const first = results[0] || {};
    const lat = first.latitude || null;
    const lng = first.longitude || null;

    res.render('mypage', {
      loginUserName: req.session.loginUserName,
      lat,
      lng,
      locationsData: results // ✅ 가공하지 않은 DB 결과(좌표)를 그대로 전달
    });
  });
});
