import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  vus: 10,              // 10 параллельных пользователей
  duration: '30s',       // тест длительностью 30 секунд
};

export default function () {
  // Замените URL на адрес вашего тестируемого приложения
  let res = http.get('https://test-api.k6.io');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}