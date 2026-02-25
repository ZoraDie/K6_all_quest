import { group, sleep, check } from "k6";
import http from "k6/http";
import { SharedArray } from "k6/data";


// Читаем данные из CSV файла
const users = new SharedArray("users", function () {
  // Открываем файл DataCSV.csv
  const content = open("./DataCSV.csv");
  
  // Разбиваем по строкам и пропускаем заголовки
  return content.split("\n")
    .slice(1) // пропускаем первую строку с заголовками
    .map(line => {
      const [username, password] = line.trim().split(",");
      return { 
        username: username?.trim(), 
        password: password?.trim() 
      };
    })
    .filter(user => user.username && user.password); // убираем пустые строки
});

console.log(`✅ Loaded ${users.length} users from CSV`);

export const options = {
  // По одному пользователю за раз
  vus: 1,
  // По одной итерации на каждого пользователя
  iterations: users.length,
  // Максимальное время на всех пользователей (по 20 секунд на каждого)
  duration: `${users.length * 20}s`,
  
  thresholds: {
    http_req_failed: ["rate<0.1"], // менее 10% ошибок
    http_req_duration: ["p(95)<2000"], // 95% запросов быстрее 2s
  },
};

// Функция для извлечения userSession из HTML формы
function extractUserSession(html) {
  const match = html.match(/name="userSession"\s+value="([^"]+)"/i);
  return match ? match[1] : null;
}

// Функция для извлечения outboundFlight из результатов поиска
function extractOutboundFlight(html) {
  const match = html.match(/name="outboundFlight"\s+value="([^"]+)"/i);
  return match ? match[1] : null;
}

// Функция для извлечения flightID из itinerary
function extractFlightIDs(html) {
  if (!html || html.startsWith("GIF") || html.startsWith("gif")) {
    return [];
  }
  
  const flightIDs = [];
  const pattern = /name="flightID"\s+value="([^"]+)"/g;
  let match;
  
  while ((match = pattern.exec(html)) !== null) {
    flightIDs.push(match[1]);
  }
  
  return flightIDs;
}

// Функция для извлечения ID забронированного рейса
function extractBookedFlightID(html) {
  const match = html.match(/([0-9]+-[0-9]+-[A-Z]{2})/);
  return match ? match[1] : null;
}

export default function () {
  // Получаем данные для текущего пользователя
  const userData = users[__ITER];
  
  if (!userData) {
    console.log(`❌ No user data for iteration ${__ITER}`);
    return;
  }
  
  console.log(`\n=== Starting test for user ${__ITER + 1}/${users.length}: ${userData.username} ===`);
  
  let params;
  let resp;
  let url;
  const vars = {};

  group("WebTours Critical Flow: Login → Book → Cancel", function () {
    // === 1. ПОЛУЧАЕМ userSession ===
    console.log(`[${userData.username}] Getting userSession...`);
    
    params = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
        "Accept-Encoding": "gzip, deflate",
        "Upgrade-Insecure-Requests": "1",
      },
      cookies: {},
    };

    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/nav.pl?in=home`;
    resp = http.request("GET", url, null, params);

    check(resp, {
      "GET nav.pl?in=home status is 200": (r) => r.status === 200,
    });

    vars.userSession = extractUserSession(resp.body);
    console.log(`✅ [${userData.username}] UserSession: ${vars.userSession}`);

    sleep(1);

    // === 2. ЛОГИН ===
    console.log(`[${userData.username}] Logging in...`);

    params = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "http://webtours.load-test.ru:1080",
        "Upgrade-Insecure-Requests": "1",
      },
      cookies: {},
    };

    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/login.pl`;
    
    const loginBody = `userSession=${encodeURIComponent(vars.userSession)}&username=${encodeURIComponent(userData.username)}&password=${encodeURIComponent(userData.password)}&login.x=64&login.y=7&JSFormSubmit=off`;
    
    resp = http.request("POST", url, loginBody, params);

    const loginSuccess = check(resp, {
      "POST login status is 200": (r) => r.status === 200,
      "login successful": (r) => {
        const success = !r.body.includes("Invalid") && 
                       (r.body.includes("User password was correct") || 
                        r.body.includes("Welcome") || 
                        r.body.includes("Menu"));
        return success;
      },
    });

    if (loginSuccess) {
      console.log(`✅ [${userData.username}] Login successful!`);
    } else {
      console.log(`❌ [${userData.username}] Login failed!`);
      return; // Прерываем выполнение для этого пользователя
    }

    sleep(1);

    // === 3. ПЕРЕХОД К ПОИСКУ РЕЙСОВ ===
    console.log(`[${userData.username}] Navigating to flight search...`);

    params.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
      "Upgrade-Insecure-Requests": "1",
      "Referer": "http://webtours.load-test.ru:1080/cgi-bin/login.pl",
    };

    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=home`;
    resp = http.request("GET", url, null, params);
    check(resp, { "GET nav.pl?page=menu&in=home status is 200": (r) => r.status === 200 });

    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?page=search`;
    resp = http.request("GET", url, null, params);
    check(resp, { "GET welcome.pl?page=search status is 200": (r) => r.status === 200 });

    params.headers.Referer = "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?page=search";
    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=flights`;
    resp = http.request("GET", url, null, params);
    check(resp, { "GET nav.pl?page=menu&in=flights status is 200": (r) => r.status === 200 });

    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/reservations.pl?page=welcome`;
    resp = http.request("GET", url, null, params);
    check(resp, { "GET reservations.pl?page=welcome status is 200": (r) => r.status === 200 });

    sleep(1);

    // === 4. ПОИСК РЕЙСОВ (POST) ===
    console.log(`[${userData.username}] Searching for flights...`);

    params = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "http://webtours.load-test.ru:1080",
        "Upgrade-Insecure-Requests": "1",
        "Referer": "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl?page=welcome",
      },
      cookies: {},
    };

    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/reservations.pl`;
    const searchBody = "advanceDiscount=0&depart=Denver&departDate=02/24/2026&arrive=Denver&returnDate=02/25/2026&numPassengers=1&seatPref=None&seatType=Coach&findFlights.x=56&findFlights.y=2&.cgifields=seatPref";
    
    resp = http.request("POST", url, searchBody, params);

    check(resp, {
      "POST flight search status is 200": (r) => r.status === 200,
    });

    vars.outboundFlight = extractOutboundFlight(resp.body);
    console.log(`✅ [${userData.username}] Found flight: ${vars.outboundFlight}`);

    sleep(1);

    // === 5. ВЫБОР РЕЙСА ===
    console.log(`[${userData.username}] Selecting flight...`);

    params.headers.Referer = "http://webtours.load-test.ru:1080/cgi-bin/reservations.pl";
    const selectBody = `outboundFlight=${encodeURIComponent(vars.outboundFlight)}&numPassengers=1&advanceDiscount=0&seatType=Coach&seatPref=None&reserveFlights.x=47&reserveFlights.y=6`;
    
    resp = http.request("POST", url, selectBody, params);

    check(resp, {
      "POST flight selection status is 200": (r) => r.status === 200,
    });

    sleep(1);

    // === 6. БРОНИРОВАНИЕ ===
    console.log(`[${userData.username}] Booking flight...`);

    const bookBody = `firstName=User${__ITER + 1}&lastName=Test&address1=${__ITER + 1}+Test+St&address2=Test+City&pass1=User${__ITER + 1}+Test&creditCard=4111111111111111&expDate=12%2F25&numPassengers=1&seatType=Coach&seatPref=None&outboundFlight=${encodeURIComponent(vars.outboundFlight)}&advanceDiscount=0&returnFlight=&JSFormSubmit=off&buyFlights.x=46&buyFlights.y=9&.cgifields=saveCC`;
    
    resp = http.request("POST", url, bookBody, params);

    const bookingSuccess = check(resp, {
      "POST flight booking status is 200": (r) => r.status === 200,
      "booking confirmed": (r) => r.body.includes("Thank you") || 
                                 r.body.includes("Flight Confirmation") ||
                                 r.body.includes("booked"),
    });

    if (bookingSuccess) {
      console.log(`✅ [${userData.username}] Flight booked!`);
      
      // Извлекаем ID забронированного рейса
      vars.bookedFlightID = extractBookedFlightID(resp.body);
      console.log(`✅ [${userData.username}] Flight ID: ${vars.bookedFlightID}`);
    }

    // === 7. ПЕРЕХОД К ПРОСМОТРУ МАРШРУТОВ ===
    console.log(`[${userData.username}] Viewing itinerary...`);

    // Даем время на обработку бронирования
    sleep(2);

    params.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
      "Upgrade-Insecure-Requests": "1",
      "Referer": "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=flights",
    };

    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?page=itinerary`;
    resp = http.request("GET", url, null, params);
    check(resp, { "GET welcome.pl?page=itinerary status is 200": (r) => r.status === 200 });

    params.headers.Referer = "http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?page=itinerary";
    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=itinerary`;
    resp = http.request("GET", url, null, params);
    check(resp, { "GET nav.pl?page=menu&in=itinerary status is 200": (r) => r.status === 200 });

    // Загружаем страницу с маршрутами
    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/itinerary.pl`;
    resp = http.request("GET", url, null, params);
    check(resp, { "GET itinerary.pl status is 200": (r) => r.status === 200 });

    // Извлекаем flight IDs
    let flightIDs = extractFlightIDs(resp.body);
    
    console.log(`📋 [${userData.username}] Found ${flightIDs.length} flights: ${JSON.stringify(flightIDs)}`);

    // Если не нашли рейсы, но есть ID забронированного рейса, используем его
    if (flightIDs.length === 0 && vars.bookedFlightID) {
      console.log(`⚠️ [${userData.username}] Using booked flight ID: ${vars.bookedFlightID}`);
      flightIDs = [vars.bookedFlightID];
    }

    // === 8. ОТМЕНА РЕЙСОВ ===
    if (flightIDs.length > 0) {
      console.log(`[${userData.username}] Cancelling ${flightIDs.length} flights...`);

      params = {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": "http://webtours.load-test.ru:1080",
          "Upgrade-Insecure-Requests": "1",
          "Referer": "http://webtours.load-test.ru:1080/cgi-bin/itinerary.pl",
        },
        cookies: {},
      };

      url = http.url`http://webtours.load-test.ru:1080/cgi-bin/itinerary.pl`;
      
      // Формируем тело запроса
      let cancelBody = "";
      
      // Добавляем все flight IDs
      flightIDs.forEach(id => {
        cancelBody += `flightID=${encodeURIComponent(id)}&`;
      });
      
      // Добавляем координаты кнопки
      cancelBody += `removeAllFlights.x=68&removeAllFlights.y=13&`;
      
      // Добавляем .cgifields
      cancelBody += `.cgifields=1`;
      
      resp = http.request("POST", url, cancelBody, params);

      const cancelSuccess = check(resp, {
        "POST cancel reservations status is 200": (r) => r.status === 200,
        "flights cancelled successfully": (r) => {
          const success = r.body.includes("deleted") || 
                         r.body.includes("removed") ||
                         r.body.includes("No flights");
          
          if (success) console.log(`✅ [${userData.username}] Flights cancelled!`);
          return success;
        },
      });

      if (cancelSuccess) {
        // Проверяем отмену
        sleep(1);
        
        params.headers.Referer = "http://webtours.load-test.ru:1080/cgi-bin/itinerary.pl";
        url = http.url`http://webtours.load-test.ru:1080/cgi-bin/itinerary.pl`;
        resp = http.request("GET", url, null, params);
        
        const remainingFlights = extractFlightIDs(resp.body);
        console.log(`📋 [${userData.username}] Remaining flights: ${remainingFlights.length}`);
      }
    } else {
      console.log(`⚠️ [${userData.username}] No flights to cancel`);
    }

    sleep(1);

    // === 9. ВЫХОД ===
    console.log(`[${userData.username}] Signing off...`);

    params.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
      "Upgrade-Insecure-Requests": "1",
      "Referer": "http://webtours.load-test.ru:1080/cgi-bin/nav.pl?page=menu&in=itinerary",
    };

    url = http.url`http://webtours.load-test.ru:1080/cgi-bin/welcome.pl?signOff=1`;
    resp = http.request("GET", url, null, params);
    check(resp, { "GET signOff status is 200": (r) => r.status === 200 });

    console.log(`✅ [${userData.username}] Test completed!`);
  });
  
  // Задержка между пользователями
  sleep(3);
}