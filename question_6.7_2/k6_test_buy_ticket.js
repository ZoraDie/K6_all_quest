import { group, sleep, check } from "k6";
import http from "k6/http";
import { SharedArray } from "k6/data";

// Читаем данные из CSV файла
const users = new SharedArray("users", function () {
  const content = open("./DataCSV.csv");
  // Пропускаем первую строку с заголовками
  return content.split("\n")
    .slice(1)
    .map(line => {
      const [username, password] = line.trim().split(",");
      return { username: username?.trim(), password: password?.trim() };
    })
    .filter(user => user.username && user.password);
});

console.log(`Loaded ${users.length} users from CSV`);

export const options = {
  vus: 1,
  iterations: users.length,
  duration: `${users.length * 30}s`,
  
  thresholds: {
    http_req_failed: ["rate<0.2"],
    http_req_duration: ["p(95)<10000"],
    checks: ["rate>0.8"],
  },
};

// Функция для извлечения userSession из HTML формы
function extractUserSession(html) {
  const patterns = [
    /name="userSession"\s+value="([^"]+)"/i,
    /name='userSession'\s+value='([^']+)'/i,
    /<input[^>]*name="userSession"[^>]*value="([^"]+)"/i,
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

export default function () {
  const userData = users[__ITER];
  
  if (!userData) {
    console.log(`No user data for iteration ${__ITER}`);
    return;
  }
  
  console.log(`\n=== Starting test for user ${__ITER + 1}/${users.length}: ${userData.username} ===`);
  
  // Создаем новую cookie jar для каждого пользователя
  const jar = http.cookieJar();
  
  const baseParams = {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    },
    timeout: "30s",
  };

  // 1. Загружаем главную страницу
  console.log(`[${userData.username}] Loading main page...`);
  const mainResp = http.get("http://webtours.load-test.ru:1080/webtours/", baseParams);
  
  check(mainResp, {
    "main page loaded": (r) => r.status === 200,
  });

  sleep(1);

  // 2. Загружаем header.html
  console.log(`[${userData.username}] Loading header...`);
  http.get(
    "http://webtours.load-test.ru:1080/webtours/header.html",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/webtours/",
      }),
    })
  );

  sleep(0.5);

  // 3. Загружаем welcome.pl
  console.log(`[${userData.username}] Loading welcome page...`);
  const welcomeResp = http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?signOff=true",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/webtours/",
      }),
    })
  );

  check(welcomeResp, {
    "welcome page loaded": (r) => r.status === 200,
  });

  // Выводим cookies для отладки
  const cookies = jar.cookiesForURL("http://webtours.load-test.ru:1080/");
  console.log(`[${userData.username}] Cookies:`, JSON.stringify(cookies));

  sleep(0.5);

  // 4. Загружаем nav.pl - ЗДЕСЬ НАХОДИТСЯ ФОРМА ЛОГИНА С userSession
  console.log(`[${userData.username}] Loading login form...`);
  const navResp = http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?in=home",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?signOff=true",
      }),
    })
  );

  // Извлекаем userSession из формы логина
  const userSession = extractUserSession(navResp.body);
  
  if (!userSession) {
    console.error(`[${userData.username}] Could not extract userSession from login form`);
    console.log(`Response preview:`, navResp.body.substring(0, 500));
    return;
  }
  
  console.log(`[${userData.username}] Extracted userSession: ${userSession}`);

  // 5. Загружаем home.html
  http.get(
    "http://webtours.load-test.ru:1080/WebTours/home.html",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?signOff=true",
      }),
    })
  );

  // 6. Загружаем изображения
  console.log(`[${userData.username}] Loading images...`);
  http.batch([
    {
      method: 'GET',
      url: "http://webtours.load-test.ru:1080/webtours/images/hp_logo.png",
      params: Object.assign({}, baseParams, {
        headers: Object.assign({}, baseParams.headers, {
          "Referer": "http://webtours.load-test.ru:1080/webtours/header.html",
        }),
      }),
    },
    {
      method: 'GET',
      url: "http://webtours.load-test.ru:1080/webtours/images/webtours.png",
      params: Object.assign({}, baseParams, {
        headers: Object.assign({}, baseParams.headers, {
          "Referer": "http://webtours.load-test.ru:1080/webtours/header.html",
        }),
      }),
    },
    {
      method: 'GET',
      url: "http://webtours.load-test.ru:1080/WebTours/images/mer_login.gif",
      params: Object.assign({}, baseParams, {
        headers: Object.assign({}, baseParams.headers, {
          "Referer": "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?in=home",
        }),
      }),
    }
  ]);

  sleep(1);

  // 7. ЛОГИН с правильным userSession
  console.log(`[${userData.username}] Logging in with userSession: ${userSession}...`);
  
  const loginParams = {
    headers: {
      "User-Agent": baseParams.headers["User-Agent"],
      "Accept": baseParams.headers["Accept"],
      "Accept-Language": baseParams.headers["Accept-Language"],
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "http://webtours.load-test.ru:1080",
      "Referer": "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?in=home",
      "Cache-Control": "max-age=0",
      "Upgrade-Insecure-Requests": "1",
    },
    timeout: "30s",
  };

  // Используем правильный формат userSession
  const loginBody = `userSession=${encodeURIComponent(userSession)}&username=${encodeURIComponent(userData.username)}&password=${encodeURIComponent(userData.password)}&login.x=41&login.y=9&JSFormSubmit=off`;
  
  console.log(`[${userData.username}] Sending login request...`);
  const loginResp = http.post(
    "http://webtours.load-test.ru:1080/cgi-bin/login.pl",
    loginBody,
    loginParams
  );

  // ПРАВИЛЬНАЯ ПРОВЕРКА: логин успешен если:
  // 1. Статус 200
  // 2. Нет сообщения об ошибке "Invalid"
  // 3. Есть подтверждение успешного логина (комментарий о правильном пароле или редирект на меню)
  const loginSuccessful = check(loginResp, {
    "login status 200": (r) => r.status === 200,
    "login successful": (r) => {
      // Проверяем что нет сообщения об ошибке
      const noError = !r.body.includes("Invalid") && 
                     !r.body.includes("Illegal Access") &&
                     !r.body.includes("Error");
      
      // Проверяем признаки успешного логина
      const successIndicators = r.body.includes("User password was correct") || 
                                r.body.includes("Welcome") || 
                                r.body.includes("Menu") ||
                                r.body.includes("Flights") ||
                                r.body.includes("nav.pl?page=menu");
      
      return noError && successIndicators;
    },
  });

  if (loginSuccessful) {
    console.log(`[${userData.username}] ✓ Login successful!`);
  } else {
    console.error(`[${userData.username}] ✗ Login failed`);
    console.log(`[${userData.username}] Response preview:`, loginResp.body.substring(0, 300));
    return;
  }

  sleep(1);

  // 8. Пост-логин навигация
  console.log(`[${userData.username}] Loading menu...`);
  http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=home",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/login.pl",
      }),
    })
  );

  http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/login.pl?intro=true",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/login.pl",
      }),
    })
  );

  // 9. Загружаем изображения меню
  const menuImages = ["flights.gif", "itinerary.gif", "in_home.gif", "signoff.gif"];
  http.batch(menuImages.map(img => ({
    method: 'GET',
    url: `http://webtours.load-test.ru:1080/WebTours/images/${img}`,
    params: Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=home",
      }),
    }),
  })));

  sleep(1);

  // 10. Поиск рейсов
  console.log(`[${userData.username}] Searching for flights...`);
  
  http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?page=search",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=home",
      }),
    })
  );

  http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=flights",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?page=search",
      }),
    })
  );

  http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl?page=welcome",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?page=search",
      }),
    })
  );

  // 11. Загружаем изображения для поиска
  const searchImages = ["button_next.gif", "in_flights.gif", "home.gif"];
  http.batch(searchImages.map((img, index) => ({
    method: 'GET',
    url: `http://webtours.load-test.ru:1080/WebTours/images/${img}`,
    params: Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": index === 0 
          ? "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl?page=welcome"
          : "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=flights",
      }),
    }),
  })));

  sleep(1);

  // 12. Поиск рейсов (POST)
  console.log(`[${userData.username}] POST flight search...`);
  
  const searchParams = {
    headers: {
      "User-Agent": baseParams.headers["User-Agent"],
      "Accept": baseParams.headers["Accept"],
      "Accept-Language": baseParams.headers["Accept-Language"],
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "http://webtours.load-test.ru:1080",
      "Referer": "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl?page=welcome",
      "Cache-Control": "max-age=0",
      "Upgrade-Insecure-Requests": "1",
    },
    timeout: "30s",
  };

  const searchBody = "advanceDiscount=0&depart=Denver&departDate=02/24/2026&arrive=Denver&returnDate=02/25/2026&numPassengers=1&seatPref=None&seatType=Coach&findFlights.x=56&findFlights.y=2&.cgifields=seatPref";
  
  const searchResp = http.post(
    "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl",
    searchBody,
    searchParams
  );

  check(searchResp, {
    "flight search status 200": (r) => r.status === 200,
  });

  // Извлекаем outboundFlight
  const flightPattern = /name="outboundFlight"\s+value="([^"]+)"/i;
  const flightMatch = searchResp.body.match(flightPattern);
  
  if (!flightMatch) {
    console.error(`[${userData.username}] No flights found`);
    return;
  }
  
  const outboundFlight = flightMatch[1];
  console.log(`[${userData.username}] Found flight: ${outboundFlight}`);

  sleep(1);

  // 13. Выбор рейса
  console.log(`[${userData.username}] Selecting flight...`);
  
  const selectBody = `outboundFlight=${encodeURIComponent(outboundFlight)}&numPassengers=1&advanceDiscount=0&seatType=Coach&seatPref=None&reserveFlights.x=47&reserveFlights.y=6`;
  
  const selectResp = http.post(
    "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl",
    selectBody,
    searchParams
  );

  check(selectResp, {
    "flight selection status 200": (r) => r.status === 200,
  });
  
  sleep(1);

  // 14. Бронирование
  console.log(`[${userData.username}] Booking flight...`);
  
  const bookBody = `firstName=User${__ITER + 1}&lastName=Test&address1=${__ITER + 1}+Test+Street&address2=Test+City&pass1=User${__ITER + 1}+Test&creditCard=4111111111111111&expDate=12%2F25&numPassengers=1&seatType=Coach&seatPref=None&outboundFlight=${encodeURIComponent(outboundFlight)}&advanceDiscount=0&returnFlight=&JSFormSubmit=off&buyFlights.x=46&buyFlights.y=9&.cgifields=saveCC`;
  
  const bookResp = http.post(
    "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl",
    bookBody,
    searchParams
  );

  const bookingSuccess = check(bookResp, {
    "booking status 200": (r) => r.status === 200,
    "booking confirmed": (r) => r.body.includes("Thank you") || 
                               r.body.includes("Flight Confirmation") || 
                               r.body.includes("booked") ||
                               r.body.includes("reserved"),
  });

  if (bookingSuccess) {
    console.log(`[${userData.username}] ✓ Flight booked successfully!`);
  } else {
    console.log(`[${userData.username}] ✗ Booking failed`);
    console.log(`[${userData.username}] Response preview:`, bookResp.body.substring(0, 300));
  }
  
  sleep(1);

  // 15. Book Another
  http.get(
    "http://webtours.load-test.ru:1080/WebTours/images/bookanother.gif",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl",
      }),
    })
  );

  http.post(
    "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl",
    "Book%20Another.x=40&Book%20Another.y=6",
    searchParams
  );

  // 16. Выход
  console.log(`[${userData.username}] Signing off...`);
  
  http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?signOff=1",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=flights",
      }),
    })
  );

  http.get(
    "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?in=home",
    Object.assign({}, baseParams, {
      headers: Object.assign({}, baseParams.headers, {
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?signOff=1",
      }),
    })
  );
  
  console.log(`[${userData.username}] ✓ Test completed!`);
  
  // Очищаем cookies для следующего пользователя
  jar.clear("http://webtours.load-test.ru:1080/");
  
  // Задержка перед следующим пользователем
  sleep(3);
}