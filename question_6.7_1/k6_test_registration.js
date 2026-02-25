import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

// Чтение данных из CSV файла
const csvData = new SharedArray('csvData', function() {
  return papaparse.parse(open('./DataCSV.csv'), { header: true }).data;
});

// Проверка загрузки данных
console.log(`Загружено ${csvData.length} записей из CSV`);

// Настройки теста
export const options = {
  vus: 10,
  duration: '1m',
};

export default function() {
  // --- 1. Получение данных пользователя для текущей итерации ---
  const userData = csvData[__ITER % csvData.length];
  
  // Проверка, что данные получены
  if (!userData || !userData.username) {
    console.error('Ошибка: не удалось получить данные пользователя');
    return;
  }
  
  console.log(`Итерация ${__ITER}: Регистрация пользователя ${userData.username}`);

  // --- 2. Главная страница ---
  let baseUrl = 'http://webtours.load-test.ru:1080';
  let res = http.get(baseUrl + '/webtours/');
  check(res, { 'главная страница доступна': (r) => r.status === 200 });

  // --- 3. Переход на страницу регистрации ---
  res = http.get(baseUrl + '/cgi-bin/login.pl');
  check(res, { 'страница регистрации открыта': (r) => r.status === 200 });

  sleep(1);

  // --- 4. Отправка данных регистрационной формы ---
  let registrationUrl = baseUrl + '/cgi-bin/login.pl';
  
  // Формируем данные для POST запроса
  let formData = {
    'username': userData.username,
    'password': userData.password,
    'passwordConfirm': userData.password,
    'firstName': userData.firstName,
    'lastName': userData.lastName,
    'address1': userData.streetAddress,
    'address2': userData.citystate,
    'register.x': '58',  // Координаты кнопки регистрации
    'register.y': '14'    // (обычно требуются для формы)
  };

  let params = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };

  console.log(`Отправка данных для ${userData.username}`);
  res = http.post(registrationUrl, formData, params);

  // --- 5. Проверка результатов ---
  let successCheck = check(res, {
    'регистрация выполнена (статус 200)': (r) => r.status === 200,
    'текст успеха на странице': (r) => r.body.includes('Thank you') || 
                                         r.body.includes('Welcome') || 
                                         r.body.includes('success'),
  });

  if (!successCheck) {
    console.log(`Проблема с регистрацией ${userData.username}: статус ${res.status}`);
    console.log(`Длина ответа: ${res.body.length} символов`);
  }

  sleep(2);
}