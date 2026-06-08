(function () {
  'use strict';

  var DAY_SECONDS = 60;
  var MAX_DAYS = 7;
  var tickMs = 1000;
  var selectedTaskId = null;
  var timer = null;
  var state;

  var taskTypes = [
    { type: '读论文', cpu: 8, gpu: 0, ram: 10, net: 24, quality: 0.75, ai: 9 },
    { type: '跑实验', cpu: 24, gpu: 42, ram: 38, net: 8, quality: 0.65, ai: 4 },
    { type: '改代码', cpu: 28, gpu: 4, ram: 24, net: 6, quality: 0.7, ai: 7 },
    { type: '写报告', cpu: 12, gpu: 0, ram: 14, net: 12, quality: 0.62, ai: 20 },
    { type: '做 PPT', cpu: 14, gpu: 8, ram: 18, net: 10, quality: 0.58, ai: 15 }
  ];

  var agentTypes = {
    fast: { name: '速通 Agent', speed: 1.55, quality: -10, ai: 16, cpu: 20, gpu: 4, ram: 18, net: 14, fail: 0.16 },
    stable: { name: '稳健 Agent', speed: 0.92, quality: 14, ai: -6, cpu: 14, gpu: 2, ram: 14, net: 8, fail: 0.06 },
    lab: { name: '实验 Agent', speed: 1.15, quality: 8, ai: 0, cpu: 20, gpu: 34, ram: 34, net: 6, fail: 0.1 },
    writer: { name: '文书 Agent', speed: 1.08, quality: 6, ai: 10, cpu: 12, gpu: 0, ram: 12, net: 10, fail: 0.09 }
  };

  var eventPool = [
    {
      title: '导师突然问进度',
      text: '导师发来消息：“你现在方便说一下实验进度吗？”',
      urgency: 24
    },
    {
      title: '开黑队友催你上线',
      text: '队友已经开房间了，再不上线就要被踢。',
      effect: function () {
        state.fun = clamp(state.fun - 3, 0, 100);
        state.focus = clamp(state.focus - 4, 0, 100);
      }
    },
    {
      title: '校园网波动',
      text: '校园网开始抽风，所有需要联网的 Agent 都变慢。',
      effect: function () {
        state.netPenalty = 14;
      }
    },
    {
      title: '显卡温度飙升',
      text: '游戏和实验同时压 GPU，风扇像要起飞。',
      effect: function () {
        state.thermalPenalty = 12;
        state.risk = clamp(state.risk + 3, 0, 100);
      }
    },
    {
      title: 'Agent 编了一个引用',
      text: '某个 Agent 写出了一篇不存在的论文引用。',
      effect: function () {
        state.risk = clamp(state.risk + 8, 0, 100);
        state.mentor = clamp(state.mentor - 4, 0, 100);
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

  function createTask() {
    var base = taskTypes[randomInt(0, taskTypes.length - 1)];
    var id = 'task-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    return {
      id: id,
      type: base.type,
      title: makeTaskTitle(base.type),
      progress: 0,
      quality: Math.round(base.quality * 40),
      aiTaste: base.ai + randomInt(0, 10),
      deadline: randomInt(42, 96),
      required: base,
      assigned: null,
      state: '待分配'
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
    return {
      day: 1,
      timeLeft: DAY_SECONDS,
      paused: false,
      fun: 0,
      mentor: 65,
      risk: 10,
      focus: 80,
      gameMode: 'high',
      netPenalty: 0,
      thermalPenalty: 0,
      message: null,
      completed: 0,
      failed: 0,
      submittedQuality: 0,
      tasks: [createTask(), createTask(), createTask()],
      agents: [
        { id: 'a-fast', type: 'fast', taskId: null, state: '空闲', cooldown: 0 },
        { id: 'a-stable', type: 'stable', taskId: null, state: '空闲', cooldown: 0 },
        { id: 'a-lab', type: 'lab', taskId: null, state: '空闲', cooldown: 0 },
        { id: 'a-writer', type: 'writer', taskId: null, state: '空闲', cooldown: 0 }
      ],
      logs: []
    };
  }

  function log(text, kind) {
    state.logs.unshift({ text: text, kind: kind || '' });
    state.logs = state.logs.slice(0, 28);
  }

  function getGameLoad() {
    if (state.gameMode === 'off') {
      return { cpu: 4, gpu: 0, ram: 6, net: 2, fun: 0 };
    }
    if (state.gameMode === 'low') {
      return { cpu: 18, gpu: 30, ram: 22, net: 8, fun: 1.3 };
    }
    return { cpu: 30, gpu: 58, ram: 34, net: 14, fun: 2.3 };
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
      resources.cpu += spec.cpu;
      resources.gpu += spec.gpu;
      resources.ram += spec.ram;
      resources.net += spec.net;
    });

    resources.gpu += state.thermalPenalty;
    Object.keys(resources).forEach(function (key) {
      resources[key] = clamp(Math.round(resources[key]), 0, 130);
    });
    return resources;
  }

  function pressureMultiplier(resources) {
    var max = Math.max(resources.cpu, resources.gpu, resources.ram, resources.net);
    if (max > 112) {
      return 0.25;
    }
    if (max > 95) {
      return 0.55;
    }
    if (max > 82) {
      return 0.78;
    }
    return 1;
  }

  function tick() {
    if (state.paused) {
      return render();
    }

    var resources = calculateResources();
    var pressure = pressureMultiplier(resources);
    var game = getGameLoad();

    state.timeLeft -= 1;
    state.fun = clamp(state.fun + (game.fun * (resources.gpu > 92 ? 0.45 : 1)), 0, 100);
    state.focus = clamp(state.focus - (state.gameMode === 'off' ? 0.2 : 0.55), 0, 100);
    state.netPenalty = Math.max(0, state.netPenalty - 1);
    state.thermalPenalty = Math.max(0, state.thermalPenalty - 1);

    state.tasks.forEach(function (task) {
      task.deadline -= 1;
      if (task.deadline <= 0 && task.state !== '已提交' && task.state !== '失败') {
        task.state = '失败';
        state.failed += 1;
        state.mentor = clamp(state.mentor - 12, 0, 100);
        state.risk = clamp(state.risk + 6, 0, 100);
        releaseAgent(task.id);
        log('截止了：' + task.title + ' 没交上去。导师脸色不太好。', 'bad');
      }
    });

    state.agents.forEach(function (agent) {
      if (agent.cooldown > 0) {
        agent.cooldown -= 1;
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
      var spec = agentTypes[agent.type];
      if ((resources.ram > 108 || resources.gpu > 118) && Math.random() < spec.fail) {
        agent.state = resources.ram > 108 ? 'OOM' : '过热卡住';
        task.state = '卡住';
        state.risk = clamp(state.risk + 4, 0, 100);
        log(spec.name + ' 在处理“' + task.title + '”时' + agent.state + '。', 'bad');
        return;
      }
      if (agent.state === 'OOM' || agent.state === '过热卡住') {
        return;
      }
      agent.state = '执行中';
      task.state = '执行中';
      task.progress = clamp(task.progress + spec.speed * pressure * randomInt(4, 7), 0, 100);
      task.quality = clamp(task.quality + spec.quality * 0.05 + randomInt(0, 2), 0, 100);
      task.aiTaste = clamp(task.aiTaste + spec.ai * 0.025 + (pressure < 0.6 ? 0.5 : 0), 0, 100);
      if (task.progress >= 100) {
        task.state = '待提交';
        agent.taskId = null;
        agent.state = '空闲';
        log('完成草稿：' + task.title + '。现在可以提交，最好先看一下 AI 味。', 'good');
      }
    });

    if (Math.random() < 0.12 && !state.message) {
      triggerEvent();
    }

    if (state.timeLeft <= 0) {
      nextDay();
    }

    render();
  }

  function triggerEvent() {
    var event = eventPool[randomInt(0, eventPool.length - 1)];
    if (event.urgency) {
      state.message = {
        text: event.text,
        urgency: event.urgency,
        ttl: 22
      };
      log(event.title + '。你要不要从游戏里切出来？');
    } else {
      event.effect();
      log(event.title + '：' + event.text, event.title.indexOf('异常') >= 0 ? 'bad' : '');
    }
  }

  function nextDay() {
    state.day += 1;
    state.timeLeft = DAY_SECONDS;
    state.tasks = state.tasks.filter(function (task) {
      return task.state !== '已提交' && task.state !== '失败';
    });
    while (state.tasks.length < 3 + Math.floor(state.day / 3)) {
      state.tasks.push(createTask());
    }
    state.focus = clamp(state.focus + 24, 0, 100);
    state.mentor = clamp(state.mentor - Math.max(0, state.tasks.length - 4) * 3, 0, 100);
    log('新的一天开始。导师又想起你了。');
    if (state.day > MAX_DAYS) {
      finishGame();
    }
  }

  function finishGame() {
    clearInterval(timer);
    timer = null;
    var avgQuality = state.completed ? Math.round(state.submittedQuality / state.completed) : 0;
    var score = Math.round(state.fun + state.mentor + avgQuality - state.risk - state.failed * 12);
    var title = '摸鱼平衡者';
    if (state.fun > 85 && state.mentor > 70 && state.risk < 45) {
      title = '摸鱼大师';
    } else if (state.fun > 90 && state.mentor < 45) {
      title = 'GPU 暴君';
    } else if (state.mentor > 90 && state.fun < 35) {
      title = '导师的好学生';
    } else if (state.risk > 75) {
      title = '学术诈骗边缘人';
    } else if (state.completed >= 8) {
      title = 'Agent 资本家';
    }
    $('resultTitle').textContent = title;
    $('resultBody').textContent = '7 天过去了。你打了不少游戏，也把一部分任务外包给了 Agent。导师是否满意，取决于你是否真的兜住了质量和风险。';
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

  function releaseAgent(taskId) {
    state.agents.forEach(function (agent) {
      if (agent.taskId === taskId) {
        agent.taskId = null;
        agent.state = '空闲';
      }
    });
  }

  function assignAgent(type) {
    var task = findTask(selectedTaskId);
    if (!task || task.state === '已提交' || task.state === '失败') {
      return log('先选一个还没完成的导师任务。', 'bad');
    }
    var agent = state.agents.find(function (item) {
      return item.type === type && !item.taskId && item.cooldown <= 0;
    });
    if (!agent) {
      return log(agentTypes[type].name + ' 暂时没空。', 'bad');
    }
    releaseAgent(task.id);
    task.assigned = type;
    task.state = '执行中';
    agent.taskId = task.id;
    agent.state = '执行中';
    log('已把“' + task.title + '”交给 ' + agentTypes[type].name + '。');
    render();
  }

  function submitTask() {
    var task = findTask(selectedTaskId);
    if (!task) {
      return log('先选择一个任务再提交。', 'bad');
    }
    if (task.progress < 100) {
      return log('还没完成就提交，导师会直接看出来。', 'bad');
    }
    task.state = '已提交';
    releaseAgent(task.id);
    state.completed += 1;
    var score = clamp(task.quality - task.aiTaste * 0.35 + randomInt(-5, 8), 0, 100);
    state.submittedQuality += score;
    state.mentor = clamp(state.mentor + score * 0.12 - (task.deadline < 10 ? 4 : 0), 0, 100);
    state.risk = clamp(state.risk + Math.max(0, task.aiTaste - 48) * 0.22, 0, 100);
    log('提交了：' + task.title + '。质量 ' + Math.round(score) + '，AI 味 ' + Math.round(task.aiTaste) + '。', score > 60 ? 'good' : 'bad');
    state.tasks = state.tasks.filter(function (item) {
      return item.id !== task.id;
    });
    selectedTaskId = state.tasks[0] ? state.tasks[0].id : null;
    render();
  }

  function handleAction(action) {
    var task = findTask(selectedTaskId);
    if (action.indexOf('assign-') === 0) {
      return assignAgent(action.replace('assign-', ''));
    }
    if (action === 'game-off') {
      state.gameMode = 'off';
      log('你暂停了游戏，电脑终于喘了口气。');
    }
    if (action === 'game-low') {
      state.gameMode = 'low';
      log('切到低画质：爽度慢一点，但 Agent 更稳。');
    }
    if (action === 'game-high') {
      state.gameMode = 'high';
      log('高画质启动。希望实验别同时炸。');
    }
    if (action === 'throttle') {
      state.agents.forEach(function (agent) {
        if (agent.taskId) {
          agent.cooldown = 2;
        }
      });
      state.focus = clamp(state.focus - 4, 0, 100);
      log('后台限流 2 秒，游戏帧率稳了一点。');
    }
    if (action === 'freeze') {
      if (!task) return log('先选择一个任务。', 'bad');
      var agent = state.agents.find(function (item) { return item.taskId === task.id; });
      if (!agent) return log('这个任务没有正在跑的 Agent。', 'bad');
      agent.state = agent.state === '冻结' ? '执行中' : '冻结';
      log((agent.state === '冻结' ? '冻结' : '恢复') + '了 ' + agentTypes[agent.type].name + '。');
    }
    if (action === 'polish') {
      if (!task) return log('先选择一个任务。', 'bad');
      state.focus = clamp(state.focus - 8, 0, 100);
      task.aiTaste = clamp(task.aiTaste - randomInt(12, 22), 0, 100);
      task.deadline -= 5;
      log('你花精力润色了一下，AI 味下降，但时间更紧了。', 'good');
    }
    if (action === 'inspect') {
      if (!task) return log('先选择一个任务。', 'bad');
      state.focus = clamp(state.focus - 10, 0, 100);
      task.quality = clamp(task.quality + randomInt(8, 15), 0, 100);
      task.aiTaste = clamp(task.aiTaste - randomInt(4, 10), 0, 100);
      state.fun = clamp(state.fun - 4, 0, 100);
      log('你亲自检查了一遍，质量更稳，但游戏手感断了。', 'good');
    }
    if (action === 'submit') {
      return submitTask();
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
      return log('导师现在没问你。');
    }
    if (mode === 'ai') {
      state.risk = clamp(state.risk + 12, 0, 100);
      state.mentor = clamp(state.mentor + 2, 0, 100);
      log('Agent 自动回复了导师。很快，但有点模板味。');
    } else if (mode === 'self') {
      state.focus = clamp(state.focus - 12, 0, 100);
      state.fun = clamp(state.fun - 6, 0, 100);
      state.mentor = clamp(state.mentor + 9, 0, 100);
      state.risk = clamp(state.risk - 5, 0, 100);
      log('你亲自回复了导师，语气自然多了。', 'good');
    } else {
      state.mentor = clamp(state.mentor - 8, 0, 100);
      state.risk = clamp(state.risk + 4, 0, 100);
      log('你装没看见。短期能继续打，长期不太妙。', 'bad');
    }
    state.message = null;
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
    $('taskList').innerHTML = state.tasks.map(function (task) {
      var selected = task.id === selectedTaskId ? ' selected' : '';
      return '<article class="task-card' + selected + '" data-task-id="' + task.id + '">' +
        '<div><div class="task-title"><span class="task-type">' + task.type + '</span><span>' + task.title + '</span></div>' +
        '<div class="task-meta"><span>' + task.state + '</span><span>质量 ' + Math.round(task.quality) + '</span><span>AI 味 ' + Math.round(task.aiTaste) + '</span></div>' +
        '<div class="progress"><div style="width:' + task.progress + '%"></div></div></div>' +
        '<div class="deadline">' + task.deadline + 's</div>' +
      '</article>';
    }).join('');
  }

  function renderAgents() {
    $('agentList').innerHTML = state.agents.map(function (agent) {
      var spec = agentTypes[agent.type];
      var task = agent.taskId ? findTask(agent.taskId) : null;
      var cls = agent.state === '执行中' ? ' busy' : agent.state === 'OOM' ? ' oom' : agent.state.indexOf('卡住') >= 0 ? ' stuck' : '';
      return '<article class="agent-card' + cls + '">' +
        '<div class="agent-name"><span>' + spec.name + '</span><span class="agent-state">' + agent.state + '</span></div>' +
        '<div class="agent-meta"><span>速度 ' + spec.speed + 'x</span><span>失败率 ' + Math.round(spec.fail * 100) + '%</span></div>' +
        '<p style="margin-top:8px;color:var(--muted);font-size:13px;">' + (task ? task.title : '等待任务') + '</p>' +
      '</article>';
    }).join('');
  }

  function renderMessage() {
    var box = $('messageBox');
    if (state.message) {
      box.classList.add('urgent');
      box.innerHTML = '<p>' + state.message.text + '</p>';
      $('messageRiskText').textContent = '需要回应';
    } else {
      box.classList.remove('urgent');
      box.innerHTML = '<p>导师暂时没动静。趁现在打一把？</p>';
      $('messageRiskText').textContent = '安静';
    }
  }

  function render() {
    var resources = calculateResources();
    var score = Math.round(state.fun + state.mentor - state.risk + state.completed * 8 - state.failed * 10);
    $('dayText').textContent = state.day;
    $('clockText').textContent = state.timeLeft + 's';
    $('funText').textContent = Math.round(state.fun);
    $('mentorText').textContent = Math.round(state.mentor);
    $('riskText').textContent = Math.round(state.risk);
    $('focusText').textContent = Math.round(state.focus);
    $('scoreText').textContent = '局内评分 ' + score;
    $('thermalText').textContent = Math.max(resources.gpu, resources.ram) > 95 ? '高压运行' : '温度正常';
    $('selectedTaskText').textContent = selectedTaskId && findTask(selectedTaskId) ? findTask(selectedTaskId).title : '未选择任务';
    $('fpsText').textContent = resources.gpu > 102 || resources.ram > 108 ? '18 FPS' : state.gameMode === 'low' ? '45 FPS' : state.gameMode === 'off' ? '暂停' : '60 FPS';
    $('gameWindow').className = 'game-window ' + state.gameMode + (resources.gpu > 102 || resources.ram > 108 ? ' stutter' : '');
    $('pauseBtn').textContent = state.paused ? '继续' : '暂停';
    renderBars(resources);
    renderTasks();
    renderAgents();
    renderMessage();
    $('logList').innerHTML = state.logs.map(function (item) {
      return '<div class="log-item ' + item.kind + '">' + item.text + '</div>';
    }).join('');
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var actionButton = event.target.closest('[data-action]');
      if (actionButton) {
        handleAction(actionButton.dataset.action);
      }
      var taskCard = event.target.closest('[data-task-id]');
      if (taskCard) {
        selectedTaskId = taskCard.dataset.taskId;
        render();
      }
    });
    $('newTaskBtn').addEventListener('click', function () {
      state.tasks.push(createTask());
      state.mentor = clamp(state.mentor + 2, 0, 100);
      log('你主动接了一个新任务。导师很欣慰，但你可能会后悔。');
      render();
    });
    $('pauseBtn').addEventListener('click', function () {
      state.paused = !state.paused;
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
    state = initialState();
    selectedTaskId = state.tasks[0].id;
    log('开局：导师发来任务，你打开了游戏，也打开了 Agent 控制台。');
    render();
    timer = setInterval(tick, tickMs);
  }

  bindEvents();
  startGame();
})();
