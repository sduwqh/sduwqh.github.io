(function () {
  'use strict';

  var TICK_MS = 1000;
  var START_MINUTE = 18 * 60;
  var END_MINUTE = 26 * 60;
  var DAY_MINUTES = 24 * 60;
  var MAX_NIGHTS = 4;
  var BASE_MINUTES_PER_TICK = 3;

  var selectedTaskId = null;
  var timer = null;
  var state;

  var taskTypes = [
    {
      type: '读论文',
      cpu: 8,
      gpu: 0,
      ram: 10,
      net: 24,
      quality: 40,
      ai: 8,
      work: [90, 150],
      deadline: [160, 330],
      preferred: 'stable'
    },
    {
      type: '跑实验',
      cpu: 24,
      gpu: 42,
      ram: 38,
      net: 8,
      quality: 36,
      ai: 4,
      work: [135, 235],
      deadline: [210, 430],
      preferred: 'lab'
    },
    {
      type: '改代码',
      cpu: 28,
      gpu: 4,
      ram: 24,
      net: 6,
      quality: 38,
      ai: 7,
      work: [110, 190],
      deadline: [150, 310],
      preferred: 'stable'
    },
    {
      type: '写报告',
      cpu: 12,
      gpu: 0,
      ram: 14,
      net: 12,
      quality: 34,
      ai: 20,
      work: [95, 170],
      deadline: [140, 290],
      preferred: 'writer'
    },
    {
      type: '做 PPT',
      cpu: 14,
      gpu: 8,
      ram: 18,
      net: 10,
      quality: 34,
      ai: 15,
      work: [85, 155],
      deadline: [120, 260],
      preferred: 'writer'
    }
  ];

  var agentTypes = {
    fast: {
      name: '速通 Agent',
      short: '快',
      speed: 1.58,
      quality: -8,
      ai: 15,
      cpu: 20,
      gpu: 4,
      ram: 18,
      net: 14,
      fail: 0.14,
      fit: { '改代码': 1.1, '做 PPT': 1.04 }
    },
    stable: {
      name: '稳健 Agent',
      short: '稳',
      speed: 0.96,
      quality: 15,
      ai: -7,
      cpu: 14,
      gpu: 2,
      ram: 14,
      net: 8,
      fail: 0.05,
      fit: { '读论文': 1.18, '改代码': 1.12, '写报告': 1.06 }
    },
    lab: {
      name: '实验 Agent',
      short: '实',
      speed: 1.16,
      quality: 8,
      ai: 0,
      cpu: 20,
      gpu: 34,
      ram: 34,
      net: 6,
      fail: 0.09,
      fit: { '跑实验': 1.25, '改代码': 1.06 }
    },
    writer: {
      name: '文书 Agent',
      short: '文',
      speed: 1.08,
      quality: 8,
      ai: 8,
      cpu: 12,
      gpu: 0,
      ram: 12,
      net: 10,
      fail: 0.07,
      fit: { '写报告': 1.22, '做 PPT': 1.2, '读论文': 1.08 }
    }
  };

  var eventPool = [
    {
      title: '导师突然问进度',
      text: '导师发来消息：“方便的话，今晚把阶段性结果发我看一下。”',
      urgency: [45, 80]
    },
    {
      title: '组会同学来问细节',
      text: '同学私聊你要代码参数，回复得太像模板会增加可疑程度。',
      urgency: [35, 70]
    },
    {
      title: '开黑队友催你上线',
      text: '队友已经开房间了，再不上线就要被迫补位。',
      effect: function () {
        state.fun = clamp(state.fun - 2, 0, 100);
        state.focus = clamp(state.focus - 3, 0, 100);
      }
    },
    {
      title: '校园网波动',
      text: '校园网开始波动，需要联网的 Agent 会慢一阵。',
      effect: function () {
        state.netPenalty = clamp(state.netPenalty + 16, 0, 40);
      }
    },
    {
      title: '显卡温度飙升',
      text: '游戏和实验同时压 GPU，风扇声音明显变大。',
      effect: function () {
        state.thermalPenalty = clamp(state.thermalPenalty + 14, 0, 44);
        state.risk = clamp(state.risk + 2, 0, 100);
      }
    },
    {
      title: 'Agent 编了一个引用',
      text: '某个 Agent 写出了一条很像真的不存在引用。',
      effect: function () {
        var task = findMostRiskyTask();
        if (task) {
          task.aiTaste = clamp(task.aiTaste + 12, 0, 100);
          task.quality = clamp(task.quality - 4, 0, 100);
        }
        state.risk = clamp(state.risk + 5, 0, 100);
      }
    }
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function currentNightStart() {
    return (state.night - 1) * DAY_MINUTES + START_MINUTE;
  }

  function currentNightEnd() {
    return (state.night - 1) * DAY_MINUTES + END_MINUTE;
  }

  function nextNightStart() {
    return state.night * DAY_MINUTES + START_MINUTE;
  }

  function formatClock(minute) {
    var normalized = ((Math.floor(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    var hour = Math.floor(normalized / 60);
    var min = normalized % 60;
    return pad(hour) + ':' + pad(min);
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function formatDuration(minutes) {
    var value = Math.max(0, Math.ceil(minutes));
    var hours = Math.floor(value / 60);
    var mins = value % 60;
    if (hours <= 0) {
      return mins + 'm';
    }
    if (mins === 0) {
      return hours + 'h';
    }
    return hours + 'h ' + mins + 'm';
  }

  function createTask(fromMinute) {
    var base = taskTypes[randomInt(0, taskTypes.length - 1)];
    var deadline = fromMinute + randomInt(base.deadline[0], base.deadline[1]);
    if (state && deadline > currentNightEnd() - 20) {
      deadline = nextNightStart() + randomInt(75, 230);
    }
    var id = 'task-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    var workRequired = randomInt(base.work[0], base.work[1]);
    return {
      id: id,
      type: base.type,
      title: makeTaskTitle(base.type),
      progress: 0,
      workDone: 0,
      workRequired: workRequired,
      quality: clamp(base.quality + randomInt(-5, 8), 0, 100),
      aiTaste: clamp(base.ai + randomInt(0, 12), 0, 100),
      deadlineMinute: deadline,
      preferred: base.preferred,
      required: base,
      assigned: null,
      state: '待分配',
      flash: 0
    };
  }

  function makeTaskTitle(type) {
    var map = {
      '读论文': ['整理 Agent 系统论文摘要', '读完导师发来的 3 篇 paper', '比较 checkpoint 方案'],
      '跑实验': ['复现实验曲线', '跑一组 ablation', '测一下 GPU 占用'],
      '改代码': ['修掉实验脚本 bug', '把日志格式改整齐', '补一个调度策略'],
      '写报告': ['写周报', '整理阶段性进展', '写实验结果分析'],
      '做 PPT': ['做组会 PPT', '画系统架构图', '整理答辩页']
    };
    var list = map[type];
    return list[randomInt(0, list.length - 1)];
  }

  function initialState() {
    var baseState = {
      night: 1,
      minute: START_MINUTE,
      speed: 0,
      fun: 8,
      mentor: 65,
      risk: 10,
      focus: 82,
      gameMode: 'low',
      netPenalty: 0,
      thermalPenalty: 0,
      message: null,
      completed: 0,
      failed: 0,
      submittedQuality: 0,
      streak: 0,
      createdTasks: 0,
      tasks: [],
      agents: [
        { id: 'a-fast', type: 'fast', taskId: null, state: '空闲', throttle: 0 },
        { id: 'a-stable', type: 'stable', taskId: null, state: '空闲', throttle: 0 },
        { id: 'a-lab', type: 'lab', taskId: null, state: '空闲', throttle: 0 },
        { id: 'a-writer', type: 'writer', taskId: null, state: '空闲', throttle: 0 }
      ],
      logs: []
    };
    state = baseState;
    state.tasks = [createTask(state.minute), createTask(state.minute), createTask(state.minute)];
    return state;
  }

  function log(text, kind) {
    state.logs.unshift({ text: text, kind: kind || '' });
    state.logs = state.logs.slice(0, 32);
  }

  function toast(title, text, kind) {
    var host = $('toastHost');
    if (!host) {
      return;
    }
    var item = document.createElement('div');
    item.className = 'toast ' + (kind || '');
    item.innerHTML = '<strong>' + title + '</strong><span>' + text + '</span>';
    host.appendChild(item);
    window.setTimeout(function () {
      item.classList.add('hide');
      window.setTimeout(function () {
        if (item.parentNode) {
          item.parentNode.removeChild(item);
        }
      }, 260);
    }, 3200);
  }

  function getGameLoad() {
    if (state.gameMode === 'off') {
      return { cpu: 4, gpu: 0, ram: 6, net: 2, fun: 0, focus: -0.02 };
    }
    if (state.gameMode === 'low') {
      return { cpu: 18, gpu: 30, ram: 22, net: 8, fun: 0.09, focus: 0.025 };
    }
    return { cpu: 30, gpu: 58, ram: 34, net: 14, fun: 0.16, focus: 0.042 };
  }

  function calculateResources() {
    var load = getGameLoad();
    var resources = {
      cpu: load.cpu,
      gpu: load.gpu,
      ram: load.ram,
      net: load.net + state.netPenalty
    };

    state.agents.forEach(function (agent) {
      if (!agent.taskId || agent.state === '冻结') {
        return;
      }
      var spec = agentTypes[agent.type];
      var throttle = agent.throttle > 0 ? 0.56 : 1;
      resources.cpu += spec.cpu * throttle;
      resources.gpu += spec.gpu * throttle;
      resources.ram += spec.ram * throttle;
      resources.net += spec.net * throttle;
    });

    resources.gpu += state.thermalPenalty;
    Object.keys(resources).forEach(function (key) {
      resources[key] = clamp(Math.round(resources[key]), 0, 130);
    });
    return resources;
  }

  function pressureMultiplier(resources) {
    var max = Math.max(resources.cpu, resources.gpu, resources.ram, resources.net);
    if (max > 116) {
      return 0.38;
    }
    if (max > 100) {
      return 0.62;
    }
    if (max > 86) {
      return 0.82;
    }
    return 1;
  }

  function tick() {
    if (state.speed === 0) {
      return render();
    }

    var advance = state.speed * BASE_MINUTES_PER_TICK;
    var resources = calculateResources();
    var pressure = pressureMultiplier(resources);
    var game = getGameLoad();

    state.minute += advance;
    state.fun = clamp(state.fun + game.fun * advance * (resources.gpu > 96 ? 0.55 : 1), 0, 100);
    state.focus = clamp(state.focus - game.focus * advance, 0, 100);
    state.netPenalty = Math.max(0, state.netPenalty - advance * 0.18);
    state.thermalPenalty = Math.max(0, state.thermalPenalty - advance * 0.16);

    updateMessage(advance);
    updateDeadlines();
    updateAgents(advance, resources, pressure);
    maybeTriggerEvent(advance);

    if (state.minute >= currentNightEnd()) {
      nextNight();
    }

    render();
  }

  function updateMessage(advance) {
    if (!state.message) {
      return;
    }
    state.message.ttl -= advance;
    if (state.message.ttl > 0) {
      return;
    }
    state.mentor = clamp(state.mentor - 7, 0, 100);
    state.risk = clamp(state.risk + 5, 0, 100);
    log('你错过了导师消息，满意度下降。', 'bad');
    toast('消息错过', '导师又多记了一笔。', 'bad');
    state.message = null;
  }

  function updateDeadlines() {
    state.tasks.forEach(function (task) {
      if (task.state === '已提交' || task.state === '失败') {
        return;
      }
      if (state.minute < task.deadlineMinute) {
        return;
      }
      task.state = '失败';
      task.flash = 0;
      state.failed += 1;
      state.streak = 0;
      state.mentor = clamp(state.mentor - 10, 0, 100);
      state.risk = clamp(state.risk + 5, 0, 100);
      releaseAgent(task.id);
      log('截止了：' + task.title + ' 没交上去。导师脸色不太好。', 'bad');
      toast('任务过期', task.title + ' 没赶上截止时间。', 'bad');
    });
  }

  function updateAgents(advance, resources, pressure) {
    state.agents.forEach(function (agent) {
      if (agent.throttle > 0) {
        agent.throttle = Math.max(0, agent.throttle - advance);
      }
      if (!agent.taskId || agent.state === '冻结') {
        return;
      }
      var task = findTask(agent.taskId);
      if (!task || task.state === '失败' || task.state === '已提交') {
        agent.taskId = null;
        agent.state = '空闲';
        return;
      }
      if (agent.state === 'OOM' || agent.state === '过热卡住') {
        return;
      }

      var spec = agentTypes[agent.type];
      var failChance = spec.fail * (advance / 30);
      if ((resources.ram > 112 || resources.gpu > 120) && Math.random() < failChance) {
        agent.state = resources.ram > 112 ? 'OOM' : '过热卡住';
        task.state = '卡住';
        state.risk = clamp(state.risk + 4, 0, 100);
        log(spec.name + ' 在处理“' + task.title + '”时' + agent.state + '。先限流或换低画质。', 'bad');
        toast('Agent 卡住', spec.name + ' 需要你处理资源压力。', 'bad');
        return;
      }

      var fit = spec.fit[task.type] || 1;
      var throttle = agent.throttle > 0 ? 0.58 : 1;
      var focusFactor = state.focus < 25 ? 0.82 : 1;
      var work = advance * spec.speed * fit * pressure * throttle * focusFactor;
      agent.state = agent.throttle > 0 ? '限流' : '执行中';
      task.state = '执行中';
      task.workDone = clamp(task.workDone + work, 0, task.workRequired);
      task.progress = clamp((task.workDone / task.workRequired) * 100, 0, 100);
      task.quality = clamp(task.quality + (spec.quality * 0.018 + fit * 0.08) * advance, 0, 100);
      task.aiTaste = clamp(task.aiTaste + (spec.ai * 0.006 + (pressure < 0.65 ? 0.04 : 0)) * advance, 0, 100);

      if (task.progress >= 100) {
        task.state = '待提交';
        task.flash = 3;
        agent.taskId = null;
        agent.state = '空闲';
        log('草稿完成：' + task.title + '。现在可以检查、润色，然后提交。', 'good');
        toast('草稿完成', task.title + ' 可以收尾了。', 'good');
      }
    });

    state.tasks.forEach(function (task) {
      if (task.flash > 0) {
        task.flash -= 1;
      }
    });
  }

  function maybeTriggerEvent(advance) {
    if (state.message) {
      return;
    }
    if (Math.random() >= (advance / 60) * 0.2) {
      return;
    }
    triggerEvent();
  }

  function triggerEvent() {
    var event = eventPool[randomInt(0, eventPool.length - 1)];
    if (event.urgency) {
      state.message = {
        title: event.title,
        text: event.text,
        ttl: randomInt(event.urgency[0], event.urgency[1])
      };
      log(event.title + '。你可以让 Agent 回，也可以亲自回。');
      toast('导师消息', '这条可以先暂停想一下怎么回。', '');
      return;
    }
    event.effect();
    log(event.title + '：' + event.text, event.title.indexOf('编') >= 0 ? 'bad' : '');
  }

  function nextNight() {
    state.night += 1;
    if (state.night > MAX_NIGHTS) {
      finishGame();
      return;
    }
    state.minute = currentNightStart();
    state.focus = clamp(state.focus + 34, 0, 100);
    state.mentor = clamp(state.mentor - Math.max(0, activeTaskCount() - 4) * 2, 0, 100);
    state.message = null;
    state.netPenalty = 0;
    state.thermalPenalty = 0;
    state.tasks = state.tasks.filter(function (task) {
      return task.state !== '已提交' && task.state !== '失败';
    });
    while (state.tasks.length < 3 + Math.floor((state.night - 1) / 2)) {
      state.tasks.push(createTask(state.minute));
    }
    selectedTaskId = null;
    log('第 ' + state.night + ' 晚开始。白天混过去了，今晚继续靠调度兜底。');
    toast('新的一晚', '精力恢复了一些，先暂停规划。', 'good');
    state.speed = 0;
  }

  function activeTaskCount() {
    return state.tasks.filter(function (task) {
      return task.state !== '已提交' && task.state !== '失败';
    }).length;
  }

  function finishGame() {
    clearInterval(timer);
    timer = null;
    var avgQuality = state.completed ? Math.round(state.submittedQuality / state.completed) : 0;
    var score = Math.round(state.fun + state.mentor + avgQuality - state.risk - state.failed * 10 + state.streak * 4);
    var title = '摸鱼平衡者';
    if (state.fun > 78 && state.mentor > 72 && state.risk < 42) {
      title = '摸鱼调度大师';
    } else if (state.fun > 88 && state.mentor < 48) {
      title = '爽了但要挨骂';
    } else if (state.mentor > 88 && state.fun < 35) {
      title = '导师的好学生';
    } else if (state.risk > 72) {
      title = '差点露馅';
    } else if (state.completed >= 7) {
      title = 'Agent 包工头';
    }
    $('resultTitle').textContent = title;
    $('resultBody').textContent = MAX_NIGHTS + ' 晚过去了。好的摸鱼不是一直高画质硬冲，而是把任务交出去、盯住质量、在关键节点亲自兜底。';
    $('resultStats').innerHTML = [
      ['综合评分', score],
      ['游戏爽度', Math.round(state.fun)],
      ['导师满意度', Math.round(state.mentor)],
      ['被发现风险', Math.round(state.risk)],
      ['完成任务', state.completed],
      ['平均质量', avgQuality]
    ].map(function (item) {
      return '<div><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>';
    }).join('');
    $('resultModal').classList.add('show');
  }

  function findTask(id) {
    return state.tasks.find(function (task) {
      return task.id === id;
    });
  }

  function findMostRiskyTask() {
    var tasks = state.tasks.filter(function (task) {
      return task.state !== '已提交' && task.state !== '失败';
    });
    tasks.sort(function (a, b) {
      return b.aiTaste - a.aiTaste;
    });
    return tasks[0] || null;
  }

  function releaseAgent(taskId) {
    state.agents.forEach(function (agent) {
      if (agent.taskId === taskId) {
        agent.taskId = null;
        agent.state = '空闲';
        agent.throttle = 0;
      }
    });
  }

  function assignAgent(type) {
    var task = findTask(selectedTaskId);
    if (!task || task.state === '已提交' || task.state === '失败') {
      log('先选一个还没完成的导师任务。', 'bad');
      return;
    }
    if (task.state === '待提交') {
      log('这个任务草稿已经完成了，直接检查或提交更合适。');
      return;
    }
    var agent = state.agents.find(function (item) {
      return item.type === type && !item.taskId;
    });
    if (!agent) {
      log(agentTypes[type].name + ' 暂时没空。', 'bad');
      return;
    }
    releaseAgent(task.id);
    task.assigned = type;
    task.state = '执行中';
    agent.taskId = task.id;
    agent.state = '执行中';
    agent.throttle = 0;
    log('已把“' + task.title + '”交给 ' + agentTypes[type].name + '。');
    if (state.speed === 0) {
      toast('规划完成', '可以点 1x 或 2x 看它跑起来。', 'good');
    }
    render();
  }

  function submitTask() {
    var task = findTask(selectedTaskId);
    if (!task) {
      log('先选择一个任务再提交。', 'bad');
      return;
    }
    if (task.progress < 100) {
      log('还没完成就提交，导师会直接看出来。', 'bad');
      return;
    }
    task.state = '已提交';
    task.flash = 0;
    releaseAgent(task.id);
    state.completed += 1;
    state.streak += 1;
    var remaining = task.deadlineMinute - state.minute;
    var score = clamp(task.quality - task.aiTaste * 0.32 + randomInt(-4, 8), 0, 100);
    var bonus = score > 72 ? 8 : score > 58 ? 5 : 2;
    state.submittedQuality += score;
    state.fun = clamp(state.fun + bonus + Math.min(state.streak, 5), 0, 100);
    state.mentor = clamp(state.mentor + score * 0.1 + (remaining > 40 ? 2 : 0), 0, 100);
    state.risk = clamp(state.risk + Math.max(0, task.aiTaste - 52) * 0.18 - (score > 70 ? 2 : 0), 0, 100);
    log('提交了：' + task.title + '。质量 ' + Math.round(score) + '，AI 味 ' + Math.round(task.aiTaste) + '，连击 ' + state.streak + '。', score > 58 ? 'good' : 'bad');
    toast(score > 58 ? '提交成功' : '勉强提交', '质量 ' + Math.round(score) + '，摸鱼连击 x' + state.streak + '。', score > 58 ? 'good' : 'bad');
    state.tasks = state.tasks.filter(function (item) {
      return item.id !== task.id;
    });
    selectedTaskId = state.tasks[0] ? state.tasks[0].id : null;
    render();
  }

  function handleAction(action) {
    var task = findTask(selectedTaskId);
    if (action.indexOf('assign-') === 0) {
      assignAgent(action.replace('assign-', ''));
      return;
    }
    if (action === 'game-off') {
      state.gameMode = 'off';
      log('你暂停了游戏，电脑资源留给 Agent。');
    }
    if (action === 'game-low') {
      state.gameMode = 'low';
      log('切到低画质：爽度慢一点，但后台更稳。');
    }
    if (action === 'game-high') {
      state.gameMode = 'high';
      log('高画质启动。注意别和实验 Agent 抢显卡。');
    }
    if (action === 'enjoy-game') {
      state.gameMode = 'high';
      if (state.speed === 0) {
        state.speed = 1;
      }
      state.fun = clamp(state.fun + 2, 0, 100);
      log('趁导师安静，开高画质爽玩一会。');
      toast('爽玩游戏', '爽度上升，但留意显卡负载。', 'good');
    }
    if (action === 'safe-game') {
      state.gameMode = 'low';
      if (state.speed === 0) {
        state.speed = 1;
      }
      state.risk = clamp(state.risk - 1, 0, 100);
      log('低调挂机：游戏还在跑，后台资源也比较稳。');
    }
    if (action === 'plan-break') {
      setSpeed(0);
      return;
    }
    if (action === 'throttle') {
      var changed = 0;
      state.agents.forEach(function (agent) {
        if (agent.taskId) {
          agent.throttle = Math.max(agent.throttle, 30);
          if (agent.state === 'OOM' || agent.state === '过热卡住' || agent.state === '卡住') {
            agent.state = '限流';
          }
          changed += 1;
        }
      });
      state.focus = clamp(state.focus - 3, 0, 100);
      log(changed ? '后台限流 30 分钟：帧率稳一些，Agent 会慢一点。' : '现在没有正在跑的 Agent 可限流。', changed ? '' : 'bad');
    }
    if (action === 'freeze') {
      if (!task) {
        log('先选择一个任务。', 'bad');
        render();
        return;
      }
      var agent = state.agents.find(function (item) { return item.taskId === task.id; });
      if (!agent) {
        log('这个任务没有正在跑的 Agent。', 'bad');
        render();
        return;
      }
      agent.state = agent.state === '冻结' ? '执行中' : '冻结';
      log((agent.state === '冻结' ? '冻结' : '恢复') + '了 ' + agentTypes[agent.type].name + '。');
    }
    if (action === 'polish') {
      if (!task) {
        log('先选择一个任务。', 'bad');
        render();
        return;
      }
      if (state.focus < 8) {
        log('精力太低，润色容易越改越怪。先暂停游戏缓一下。', 'bad');
        render();
        return;
      }
      state.focus = clamp(state.focus - 8, 0, 100);
      state.fun = clamp(state.fun - 1, 0, 100);
      task.aiTaste = clamp(task.aiTaste - randomInt(12, 24), 0, 100);
      task.quality = clamp(task.quality + randomInt(2, 7), 0, 100);
      state.minute += state.speed === 0 ? 0 : 4;
      log('你润色了一遍，AI 味明显下降。', 'good');
      toast('润色完成', 'AI 味下降，提交更稳。', 'good');
    }
    if (action === 'inspect') {
      if (!task) {
        log('先选择一个任务。', 'bad');
        render();
        return;
      }
      if (state.focus < 10) {
        log('精力不够，检查效率很低。', 'bad');
        render();
        return;
      }
      state.focus = clamp(state.focus - 10, 0, 100);
      state.fun = clamp(state.fun - 2, 0, 100);
      task.quality = clamp(task.quality + randomInt(9, 17), 0, 100);
      task.aiTaste = clamp(task.aiTaste - randomInt(4, 10), 0, 100);
      state.minute += state.speed === 0 ? 0 : 6;
      log('你亲自检查了一遍，质量更稳。', 'good');
      toast('检查完成', '质量上升，风险下降。', 'good');
    }
    if (action === 'submit') {
      submitTask();
      return;
    }
    if (action === 'reply-ai') {
      replyMessage('ai');
    }
    if (action === 'reply-self') {
      replyMessage('self');
    }
    if (action === 'ignore') {
      replyMessage('ignore');
    }
    render();
  }

  function replyMessage(mode) {
    if (!state.message) {
      log('导师现在没问你。');
      return;
    }
    if (mode === 'ai') {
      state.risk = clamp(state.risk + 9, 0, 100);
      state.mentor = clamp(state.mentor + 3, 0, 100);
      log('Agent 自动回复了导师。很快，但有点模板味。');
    } else if (mode === 'self') {
      state.focus = clamp(state.focus - 10, 0, 100);
      state.fun = clamp(state.fun - 4, 0, 100);
      state.mentor = clamp(state.mentor + 9, 0, 100);
      state.risk = clamp(state.risk - 5, 0, 100);
      log('你亲自回复了导师，语气自然多了。', 'good');
      toast('回复稳住了', '导师满意度上升。', 'good');
    } else {
      state.mentor = clamp(state.mentor - 7, 0, 100);
      state.risk = clamp(state.risk + 4, 0, 100);
      log('你装没看见。短期能继续打，长期不太妙。', 'bad');
    }
    state.message = null;
  }

  function setSpeed(speed) {
    state.speed = speed;
    if (speed === 0) {
      log('进入计划暂停：可以慢慢看任务、分配 Agent，不推进游戏内时间。');
    } else {
      log('时间速度切到 ' + speed + 'x。');
    }
    render();
  }

  function renderBars(resources) {
    var labels = [
      ['cpu', 'CPU'],
      ['gpu', 'GPU'],
      ['ram', 'RAM'],
      ['net', '网络']
    ];
    $('resourceBars').innerHTML = labels.map(function (item) {
      var value = resources[item[0]];
      var cls = value > 100 ? 'danger' : value > 82 ? 'warn' : '';
      return '<div class="bar-row"><div class="bar-label"><span>' + item[1] + '</span><b>' + value + '%</b></div><div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + clamp(value, 0, 100) + '%"></div></div></div>';
    }).join('');
  }

  function renderTasks() {
    if (!state.tasks.length) {
      $('taskList').innerHTML = '<div class="empty-state">任务队列清空了。可以接一个新任务，或者开高画质爽一会。</div>';
      return;
    }
    $('taskList').innerHTML = state.tasks.map(function (task) {
      var selected = task.id === selectedTaskId ? ' selected' : '';
      var ready = task.state === '待提交' ? ' ready' : '';
      var failed = task.state === '失败' ? ' failed' : '';
      var flash = task.flash > 0 ? ' completed-flash' : '';
      var remaining = task.deadlineMinute - state.minute;
      var dueClass = remaining < 45 ? ' tight' : '';
      var agent = task.assigned ? agentTypes[task.assigned].short : '未派';
      return '<article class="task-card' + selected + ready + failed + flash + '" data-task-id="' + task.id + '">' +
        '<div><div class="task-title"><span class="task-type">' + task.type + '</span><span>' + task.title + '</span></div>' +
        '<div class="task-meta"><span>' + task.state + '</span><span>Agent ' + agent + '</span><span>质量 ' + Math.round(task.quality) + '</span><span>AI 味 ' + Math.round(task.aiTaste) + '</span></div>' +
        '<div class="progress"><div style="width:' + task.progress + '%"></div></div></div>' +
        '<div class="deadline' + dueClass + '"><strong>' + formatDuration(remaining) + '</strong><span>' + formatClock(task.deadlineMinute) + ' 截止</span></div>' +
      '</article>';
    }).join('');
  }

  function renderAgents() {
    $('agentList').innerHTML = state.agents.map(function (agent) {
      var spec = agentTypes[agent.type];
      var task = agent.taskId ? findTask(agent.taskId) : null;
      var cls = agent.state === '执行中' || agent.state === '限流' ? ' busy' : agent.state === 'OOM' ? ' oom' : agent.state.indexOf('卡住') >= 0 ? ' stuck' : '';
      var stateText = agent.state;
      if (agent.throttle > 0 && agent.taskId) {
        stateText += ' ' + formatDuration(agent.throttle);
      }
      return '<article class="agent-card' + cls + '">' +
        '<div class="agent-name"><span>' + spec.name + '</span><span class="agent-state">' + stateText + '</span></div>' +
        '<div class="agent-meta"><span>速度 ' + spec.speed + 'x</span><span>稳态 ' + Math.round((1 - spec.fail) * 100) + '%</span></div>' +
        '<p>' + (task ? task.title : '等待任务') + '</p>' +
      '</article>';
    }).join('');
  }

  function renderMessage() {
    var box = $('messageBox');
    var actions = $('messageActions');
    if (state.message) {
      box.classList.add('urgent');
      box.innerHTML = '<p>' + state.message.text + '</p><small>建议在 ' + formatDuration(state.message.ttl) + ' 内处理</small>';
      $('messageRiskText').textContent = '需要回应';
      actions.innerHTML = [
        '<button data-action="reply-ai" type="button">让 Agent 回</button>',
        '<button data-action="reply-self" type="button">亲自回</button>',
        '<button data-action="ignore" type="button">装没看见</button>'
      ].join('');
    } else {
      box.classList.remove('urgent');
      box.innerHTML = '<p>导师暂时没动静。趁现在打一把？</p>';
      $('messageRiskText').textContent = '安静';
      actions.innerHTML = [
        '<button data-action="enjoy-game" type="button">爽玩游戏</button>',
        '<button data-action="safe-game" type="button">低调挂机</button>',
        '<button data-action="plan-break" type="button">暂停规划</button>'
      ].join('');
    }
  }

  function renderSelectedDetails(resources) {
    var box = $('selectedDetails');
    var task = findTask(selectedTaskId);
    if (!task) {
      box.innerHTML = '<p>点选一个任务后，这里会显示推荐 Agent、预计剩余时间和收尾建议。</p>';
      return;
    }
    var preferred = agentTypes[task.preferred].name;
    var assigned = task.assigned ? agentTypes[task.assigned].name : '未分配';
    var remainingWork = Math.max(0, task.workRequired - task.workDone);
    var agent = task.assigned ? state.agents.find(function (item) { return item.taskId === task.id; }) : null;
    var estimate = '等待分配';
    if (agent) {
      var spec = agentTypes[agent.type];
      var pressure = pressureMultiplier(resources);
      var fit = spec.fit[task.type] || 1;
      var perMinute = Math.max(0.1, spec.speed * fit * pressure * (agent.throttle > 0 ? 0.58 : 1));
      estimate = formatDuration(remainingWork / perMinute);
    } else if (task.state === '待提交') {
      estimate = '草稿已完成';
    }
    box.innerHTML = [
      '<div><span>推荐</span><strong>' + preferred + '</strong></div>',
      '<div><span>当前</span><strong>' + assigned + '</strong></div>',
      '<div><span>预计</span><strong>' + estimate + '</strong></div>',
      '<div><span>截止</span><strong>' + formatClock(task.deadlineMinute) + '</strong></div>'
    ].join('');
  }

  function coachText(resources) {
    var task = findTask(selectedTaskId);
    var highPressure = Math.max(resources.cpu, resources.gpu, resources.ram, resources.net) > 96;
    if (state.message) {
      return '导师消息可以先处理。亲自回更稳，Agent 回更快但会涨风险。';
    }
    if (!task) {
      return '先点一个导师任务。当前是计划暂停，时间不会推进。';
    }
    if (task.state === '失败') {
      return '这个任务已经过期了，换一个任务重新安排。';
    }
    if (task.state === '待分配') {
      return '这个任务推荐用 ' + agentTypes[task.preferred].name + '。分配完再点 1x 或 2x。';
    }
    if (task.state === '卡住') {
      return 'Agent 卡住了。先限流后台，或者切低画质降低资源压力。';
    }
    if (task.state === '待提交' && task.aiTaste > 45) {
      return '草稿完成但 AI 味偏高，先润色再交会更爽。';
    }
    if (task.state === '待提交' && task.quality < 62) {
      return '草稿完成但质量一般，手动检查一次再提交。';
    }
    if (task.state === '待提交') {
      return '可以提交了。高质量提交会给摸鱼连击和爽度奖励。';
    }
    if (highPressure) {
      return '资源压力偏高。切低画质或限流后台，避免 Agent 卡住。';
    }
    if (state.speed === 0) {
      return '规划已经就绪，点 1x 看 Agent 跑；需要赶进度再切 2x 或 4x。';
    }
    return '观察进度条和截止时间。草稿完成后先检查、润色，再提交。';
  }

  function updateGuideState() {
    var steps = document.querySelectorAll('.guide-steps li');
    if (!steps.length) {
      return;
    }
    var selected = !!findTask(selectedTaskId);
    var assigned = state.tasks.some(function (task) { return task.assigned; });
    var playing = state.gameMode !== 'off';
    var ready = state.tasks.some(function (task) { return task.state === '待提交'; });
    [selected, assigned, playing, ready].forEach(function (done, index) {
      steps[index].classList.toggle('done', done);
    });
  }

  function renderSpeedButtons() {
    document.querySelectorAll('.speed-btn').forEach(function (button) {
      button.classList.toggle('active', Number(button.dataset.speed) === state.speed);
    });
  }

  function render() {
    var resources = calculateResources();
    var score = Math.round(state.fun + state.mentor - state.risk + state.completed * 9 - state.failed * 8 + state.streak * 3);
    var pressure = Math.max(resources.cpu, resources.gpu, resources.ram, resources.net);
    $('dayText').textContent = state.night;
    $('clockText').textContent = formatClock(state.minute);
    $('funText').textContent = Math.round(state.fun);
    $('mentorText').textContent = Math.round(state.mentor);
    $('riskText').textContent = Math.round(state.risk);
    $('focusText').textContent = Math.round(state.focus);
    $('scoreText').textContent = '局内评分 ' + score + (state.streak ? ' / 连击 ' + state.streak : '');
    $('thermalText').textContent = pressure > 100 ? '高压运行' : pressure > 86 ? '注意负载' : '温度正常';
    $('selectedTaskText').textContent = selectedTaskId && findTask(selectedTaskId) ? findTask(selectedTaskId).title : '未选择任务';
    $('agentHint').textContent = state.speed === 0 ? '计划暂停中' : '观察负载';
    $('fpsText').textContent = resources.gpu > 104 || resources.ram > 110 ? '18 FPS' : state.gameMode === 'low' ? '45 FPS' : state.gameMode === 'off' ? '暂停' : '60 FPS';
    $('gameWindow').className = 'game-window ' + state.gameMode + (resources.gpu > 104 || resources.ram > 110 ? ' stutter' : '');
    $('coachText').textContent = coachText(resources);
    renderBars(resources);
    renderTasks();
    renderAgents();
    renderMessage();
    renderSelectedDetails(resources);
    renderSpeedButtons();
    updateGuideState();
    $('logList').innerHTML = state.logs.map(function (item) {
      return '<div class="log-item ' + item.kind + '">' + item.text + '</div>';
    }).join('');
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var speedButton = event.target.closest('.speed-btn');
      if (speedButton) {
        setSpeed(Number(speedButton.dataset.speed));
        return;
      }
      var actionButton = event.target.closest('[data-action]');
      if (actionButton) {
        handleAction(actionButton.dataset.action);
        return;
      }
      var taskCard = event.target.closest('[data-task-id]');
      if (taskCard) {
        selectedTaskId = taskCard.dataset.taskId;
        render();
      }
    });
    $('newTaskBtn').addEventListener('click', function () {
      if (state.tasks.length >= 6) {
        log('任务太多了，再接就真不像摸鱼了。先处理掉几个。', 'bad');
        return render();
      }
      state.tasks.push(createTask(state.minute));
      state.createdTasks += 1;
      state.mentor = clamp(state.mentor + 2, 0, 100);
      log('你主动接了一个新任务。导师很欣慰，但今晚的队列更满了。');
      render();
    });
    $('restartBtn').addEventListener('click', startGame);
    $('closeResultBtn').addEventListener('click', function () {
      $('resultModal').classList.remove('show');
      startGame();
    });
  }

  function startGame() {
    if (timer) {
      clearInterval(timer);
    }
    initialState();
    selectedTaskId = null;
    log('开局：现在是计划暂停。先看任务，挑一个交给合适的 Agent。');
    toast('计划暂停', '先选任务和 Agent，再启动 1x。', 'good');
    render();
    timer = setInterval(tick, TICK_MS);
  }

  bindEvents();
  startGame();
})();
