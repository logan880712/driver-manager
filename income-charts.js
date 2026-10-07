(function (root) {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const money = value => `${Math.round(value).toLocaleString('ko-KR')}원`;
  const compactMoney = value => {
    const absolute = Math.abs(value);
    if (absolute >= 100000000) return `${Number((value / 100000000).toFixed(1))}억`;
    if (absolute >= 10000) return `${Number((value / 10000).toFixed(1))}만`;
    return Math.round(value).toLocaleString('ko-KR');
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svgElement = (tag, attributes, text) => {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function monthData(month, records) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const [year, number] = month.split('-').map(Number);
    const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const days = Array.from({ length }, (_, index) => ({
      date: `${month}-${String(index + 1).padStart(2, '0')}`,
      day: index + 1, net: 0, count: 0, recorded: false
    }));
    for (const record of records || []) {
      if (!record || typeof record.date !== 'string' || !Number.isFinite(record.net)) continue;
      const day = Number(record.date.slice(8));
      if (record.date !== `${month}-${String(day).padStart(2, '0')}` || day < 1 || day > length) continue;
      const target = days[day - 1];
      target.recorded = true;
      target.net += record.net;
      target.count += Number.isFinite(record.count) ? record.count : 0;
    }
    let cumulative = 0;
    days.forEach(day => { cumulative += day.net; day.cumulative = cumulative; });
    return { days, total: cumulative, recorded: days.filter(day => day.recorded), number };
  }

  function axisDomain(values) {
    const low = Math.min(0, ...values);
    const high = Math.max(1, ...values);
    const rawStep = (high - low) / 4;
    const power = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 2.5, 5, 10].find(value => value * power >= rawStep) * power;
    return { minimum: Math.floor(low / step) * step, maximum: Math.ceil(high / step) * step, step };
  }

  function cumulativeChart(data, month, goal) {
    const calendarDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    const currentMonth = calendarDate.slice(0, 7);
    const lastSaved = data.recorded[data.recorded.length - 1].day;
    const horizon = month < currentMonth ? data.days.length : month === currentMonth ? Math.max(Number(calendarDate.slice(8)), lastSaved) : lastSaved;
    const visible = data.days.slice(0, horizon);
    const domain = axisDomain([goal, ...visible.map(day => day.cumulative)]);
    const width = 420, height = 235, left = 56, right = 17, top = 20, bottom = 35;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const x = day => left + day / data.days.length * plotWidth;
    const y = value => top + (domain.maximum - value) / (domain.maximum - domain.minimum) * plotHeight;
    const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, class: 'income-line-chart', role: 'img' });
    svg.append(svgElement('title', {}, `${data.number}월 누적 순수익 ${money(data.total)}, 현재 설정 목표 ${money(goal)}`));
    svg.append(svgElement('desc', {}, `기록한 ${data.recorded.length}일의 순수익을 날짜순으로 누적한 그래프입니다. 점선 구간은 기록이 없어 이전 누적 금액을 유지합니다. 앞으로의 수입은 예상하지 않습니다.`));
    for (let value = domain.minimum; value <= domain.maximum + domain.step / 100; value += domain.step) {
      svg.append(svgElement('line', { x1: left, y1: y(value), x2: width - right, y2: y(value), class: value === 0 ? 'income-axis-zero' : 'income-grid' }));
      svg.append(svgElement('text', { x: left - 10, y: y(value) + 4, class: 'income-axis-label', 'text-anchor': 'end' }, compactMoney(value)));
    }
    if (goal > 0) {
      svg.append(svgElement('line', { x1: left, y1: y(goal), x2: width - right, y2: y(goal), class: 'income-goal-line' }));
    }
    let prior = { day: 0, cumulative: 0 };
    for (const day of visible) {
      svg.append(svgElement('line', {
        x1: x(prior.day), y1: y(prior.cumulative), x2: x(day.day), y2: y(day.cumulative),
        class: day.recorded ? 'income-saved-line' : 'income-missing-line'
      }));
      if (day.recorded) {
        const point = svgElement('circle', { cx: x(day.day), cy: y(day.cumulative), r: 4, class: 'income-saved-point' });
        point.append(svgElement('title', {}, `${month}-${String(day.day).padStart(2, '0')} 누적 ${money(day.cumulative)}`));
        svg.append(point);
      }
      prior = day;
    }
    const tickDays = Array.from(new Set([1, 7, 14, 21, data.days.length]));
    for (const day of tickDays) {
      svg.append(svgElement('text', { x: x(day), y: height - 14, class: 'income-axis-label', 'text-anchor': 'middle' }, `${day}일`));
    }
    return svg;
  }

  function render(container, options) {
    if (!container) return;
    const { month, records, monthlyGoal, selectedDate, onSelectDate } = options || {};
    container.replaceChildren();
    const data = monthData(month, records);
    if (!data) return;
    const goal = Number.isFinite(monthlyGoal) && monthlyGoal > 0 ? monthlyGoal : 0;
    const cumulative = element('section', 'panel income-chart-panel');
    const title = element('div', 'section-title');
    title.append(element('h2', '', '월 누적 순수익'), element('span', 'pill', `${data.number}월 기록`));
    cumulative.append(title);
    if (!data.recorded.length) {
      cumulative.append(element('p', 'income-chart-empty', `${data.number}월에 기록한 일지가 아직 없어요. 지난 근무일의 일지를 저장하면 수익 흐름이 여기에 나타나요.`));
      container.append(cumulative);
      return;
    }
    const amount = element('div', 'income-chart-total');
    amount.append(element('strong', '', money(data.total)));
    if (goal) amount.append(element('span', '', `${Math.max(0, Math.round(data.total / goal * 100))}% 달성`));
    cumulative.append(amount, element('p', 'income-chart-goal', `현재 설정 목표 ${money(goal)}`));
    cumulative.append(cumulativeChart(data, month, goal));
    const legend = element('div', 'income-chart-legend');
    for (const [style, label] of [['saved', '누적 순수익'], ['goal', '월 목표'], ['missing', '미기록 구간']]) {
      const item = element('span', '');
      item.append(element('i', `income-legend-${style}`), document.createTextNode(label));
      legend.append(item);
    }
    cumulative.append(legend, element('p', 'income-chart-note', '기록이 없는 날은 수익을 확정하지 않고 이전 누적액을 유지해요. 지난달 그래프도 현재 설정한 목표와 비교합니다.'));
    container.append(cumulative);

    const daily = element('section', 'panel income-chart-panel');
    const dailyTitle = element('div', 'section-title');
    dailyTitle.append(element('h2', '', '하루 순수익'), element('span', 'pill', `${data.recorded.length}일 근무`));
    daily.append(dailyTitle, element('p', 'income-chart-instruction', '날짜를 누르면 그날의 일지를 볼 수 있어요.'));
    const rows = element('div', 'income-day-rows');
    const maxPositive = Math.max(0, ...data.recorded.map(day => day.net));
    const maxNegative = Math.max(0, ...data.recorded.map(day => -day.net));
    // Keep one common scale for both sides of zero when expenses exceed income.
    const extent = Math.max(1, maxPositive, maxNegative);
    const hasNegative = maxNegative > 0;
    for (const day of data.recorded) {
      const date = new Date(`${day.date}T00:00:00Z`);
      const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()];
      const row = element('button', `income-day-row${day.net < 0 ? ' is-negative' : ''}${day.net === 0 ? ' is-zero' : ''}`);
      row.type = 'button';
      row.dataset.date = day.date;
      row.setAttribute('aria-pressed', String(selectedDate === day.date));
      row.setAttribute('aria-label', `${day.date} ${weekday}요일 순수익 ${money(day.net)}, ${day.count}건. 일지 보기`);
      row.append(element('span', 'income-day-label', `${day.day}일 (${weekday})`));
      const barArea = element('span', `income-bar-track${hasNegative ? ' has-negative' : ''}`);
      barArea.setAttribute('aria-hidden', 'true');
      const bar = element('i', 'income-bar-fill');
      const size = Math.abs(day.net) / extent * (hasNegative ? 50 : 100);
      bar.style.width = `${size}%`;
      bar.style.left = `${hasNegative ? (day.net < 0 ? 50 - size : 50) : 0}%`;
      barArea.append(bar);
      if (day.net === 0) barArea.append(element('i', 'income-bar-zero'));
      row.append(barArea, element('strong', 'income-day-value', money(day.net)));
      row.addEventListener('click', () => {
        const next = row.getAttribute('aria-pressed') === 'true' ? '' : day.date;
        if (typeof onSelectDate === 'function') onSelectDate(next);
      });
      rows.append(row);
    }
    daily.append(rows, element('p', 'income-chart-note', '미기록 날짜는 막대에서 제외해요. 저장된 0원은 점으로, 지출이 더 큰 날은 음수로 표시합니다.'));
    container.append(daily);
  }

  root.IncomeCharts = Object.freeze({ render });
})(window);
