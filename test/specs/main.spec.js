/*!
 * main.spec.js —— 单元测试用例
 *
 * 用例设计方法（白盒为主）：
 *   ① **分支覆盖**：每个 `if` 的"真 / 假"两侧各取一条用例。
 *      比如校验里"日期晚于今天"这条，就要有一条未来日期的（拒绝）和一条今天的（通过）。
 *   ② **边界值**：长度类字段取「下界-1 / 下界 / 上界 / 上界+1」四个点。
 *   ③ **等价类划分**：联系方式按「合法 / 位数不足 / 格式不符」分三类，各取一个。
 *   ④ **正例反例成对写**：只测"应该通过"会写出过宽的实现，只测"应该拒绝"会写出过严的实现。
 *      搜索、答案比对、权限校验这三处全部成对写。
 *   ⑤ **把不确定性剔除**：时间注入固定成 2026-10-09T10:00:00，
 *      否则"日期不能晚于今天"这类断言会随运行时刻漂移；需要验证排序时用可推进的时钟。
 *   ⑥ **每条用例一个干净仓库**：注入内存适配器，用例之间互不污染。
 *
 * 分成 9 组，按被测模块组织；每条用例名写"应该发生什么"，而不是"测哪个函数"。
 */
(function (root) {
  'use strict';

  var isNode = (typeof module === 'object' && module.exports);
  var T = isNode ? require('./fixtures.js') : root.T;
  var LF = T.LF;
  var assert = (isNode ? require('../lib/chai.js') : root.chai).assert;

  /* ============================================================
   * 一、发布校验（10 条）
   * 白盒：validatePost 里每个字段的每个 if 都取到真 / 假两侧
   * ============================================================ */

  describe('一、发布校验', function () {
    it('物品名称 1 个字被拒绝（下界外侧）', function () {
      var r = LF.validatePost(T.validLost({ title: '伞' }));
      assert.isFalse(r.ok);
      assert.isString(r.errors.title);
    });

    it('物品名称 2 个字通过（下界内侧）', function () {
      assert.isTrue(LF.validatePost(T.validLost({ title: '雨伞' })).ok);
    });

    it('物品名称 40 个字通过、41 个字被拒绝（上界两侧）', function () {
      var rep = function (n) { return new Array(n + 1).join('伞'); };
      assert.isTrue(LF.validatePost(T.validLost({ title: rep(40) })).ok);
      assert.isFalse(LF.validatePost(T.validLost({ title: rep(41) })).ok);
    });

    it('日期填明天被拒绝（未来日期那一侧）', function () {
      var r = LF.validatePost(T.validLost({ happenedAt: '2026-10-10', now: T.NOW }));
      assert.isFalse(r.ok);
      assert.include(r.errors.happenedAt, '不能晚于今天');
    });

    it('日期填今天通过，填 2 月 30 日被拒绝（等价类：合法日期 / 不存在的日期）', function () {
      assert.isTrue(LF.validatePost(T.validLost({ happenedAt: '2026-10-09', now: T.NOW })).ok);
      assert.isFalse(LF.validatePost(T.validLost({ happenedAt: '2026-02-30', now: T.NOW })).ok);
    });

    it('描述 200 个字通过、201 个字被拒绝', function () {
      var rep = function (n) { return new Array(n + 1).join('描'); };
      assert.isTrue(LF.validatePost(T.validLost({ description: rep(200) })).ok);
      assert.isFalse(LF.validatePost(T.validLost({ description: rep(201) })).ok);
    });

    it('手机号形态的联系方式通过', function () {
      assert.isTrue(LF.validatePost(T.validLost({ contactWay: '13800138000' })).ok);
    });

    it('位数不足的联系方式被拒绝（等价类：非法）', function () {
      assert.isFalse(LF.validatePost(T.validLost({ contactWay: '12' })).ok);
    });

    it('既不是手机号也不是 QQ / 微信 / 邮箱的内容被拒绝', function () {
      var r = LF.validatePost(T.validLost({ contactWay: '你猜猜看呀哈哈' }));
      assert.isFalse(r.ok);
      assert.isString(r.errors.contactWay);
    });

    it('★ 校验不通过时不会落库（不能出现"报了错但数据进去了"）', function () {
      var store = T.makeStore();
      store.createPost({ type: 'lost', title: '雨伞' });   // 缺一堆必填
      assert.strictEqual(store.countPosts({}), 0);
    });
  });

  /* ============================================================
   * 二、出题规则（6 条）
   * 白盒：validateQuestions / normalizeQuestions 的各条分支
   * ============================================================ */

  describe('二、出题规则', function () {
    it('招领 + 需要验证的分类：少于 3 道题被拒绝', function () {
      var r = LF.validatePost(T.validFound({ questions: T.validQuestions().slice(0, 2) }));
      assert.isFalse(r.ok);
      assert.isString(r.errors.questions);
    });

    it('招领 + 需要验证的分类：恰好 3 道题通过', function () {
      assert.isTrue(LF.validatePost(T.validFound({ questions: T.validQuestions() })).ok);
    });

    it('★ 空选项行被丢弃后，正确答案的下标跟着重排', function () {
      var out = LF.normalizeQuestions([
        { type: 'choice', stem: '伞骨有几根', options: ['6 根', '', '8 根'], answer: 2 }
      ]);
      assert.deepEqual(out.questions[0].options, ['6 根', '8 根']);
      assert.strictEqual(out.questions[0].answer, 1, '原来指向第 3 项，丢掉空行后应指向第 2 项');
    });

    it('判断题的选项由数据层固定为「正确 / 错误」，发布者传什么都不算数', function () {
      var out = LF.normalizeQuestions([
        { type: 'judge', stem: '伞柄是木头的', options: ['是', '否', '不确定'], answer: 2 }
      ]);
      assert.deepEqual(out.questions[0].options, LF.VERIFY.JUDGE_OPTIONS);
    });

    it('寻物信息带题目时题目被丢弃（门槛只设在招领那一侧）', function () {
      var r = LF.validatePost(T.validLost({ questions: T.validQuestions() }));
      assert.isTrue(r.ok);
      assert.strictEqual(r.value.questions.length, 0);
    });

    it('★ 「其他」类带题目时题目被丢弃（这一类没有可锁死的特征，走信任模式）', function () {
      var r = LF.validatePost(T.validFound({ category: 'other', questions: T.validQuestions() }));
      assert.isTrue(r.ok);
      assert.strictEqual(r.value.questions.length, 0);
      assert.isFalse(LF.allowVerifyFor('other'));
    });
  });

  /* ============================================================
   * 三、搜索与筛选（6 条）
   * 白盒 + 等价类：命中 / 不命中成对写
   * ============================================================ */

  describe('三、搜索与筛选', function () {
    function pool() {
      var store = T.makeStore();
      T.withPost(store, T.ME, {
        type: 'lost', category: 'card', title: '校园卡一张', contactName: '刘同学',
        location: '第一食堂二楼', description: '学号 2023 开头，卡面有贴纸'
      });
      T.withPost(store, T.OTHER, {
        type: 'found', category: 'digital', title: '白色 AirPods Pro 耳机', contactName: '周同学',
        location: '图书馆三楼自习区', description: '耳机盒有划痕'
      });
      return store;
    }

    it('关键词命中标题', function () {
      assert.lengthOf(pool().queryPosts({ keyword: '校园卡' }), 1);
    });

    it('关键词不命中时返回空（与上一条成对）', function () {
      assert.lengthOf(pool().queryPosts({ keyword: '不存在的东西xyz' }), 0);
    });

    it('命中范围覆盖描述、地点和分类名', function () {
      var store = pool();
      assert.lengthOf(store.queryPosts({ keyword: '贴纸' }), 1, '描述');
      assert.lengthOf(store.queryPosts({ keyword: '图书馆' }), 1, '地点');
      assert.lengthOf(store.queryPosts({ keyword: '证件卡片' }), 1, '分类名');
    });

    it('多个关键词按「与」匹配', function () {
      var store = pool();
      assert.lengthOf(store.queryPosts({ keyword: '耳机 图书馆' }), 1);
      assert.lengthOf(store.queryPosts({ keyword: '耳机 食堂' }), 0);
    });

    it('★ 搜索框输入正则元字符不会让页面崩（用的是 indexOf 而不是 RegExp）', function () {
      var store = pool();
      assert.doesNotThrow(function () { store.queryPosts({ keyword: '(' }); });
      assert.doesNotThrow(function () { store.queryPosts({ keyword: '.*+?[]' }); });
      assert.doesNotThrow(function () { store.queryPosts({ keyword: '\\' }); });
    });

    it('地点用子串包含匹配，且已完成的信息沉底', function () {
      var clock = T.makeClockStore();
      var a = T.withPost(clock.store, T.ME, { title: '较早的信息', location: '图书馆门口' });
      clock.tick();
      var b = T.withPost(clock.store, T.ME, { title: '较新的信息', location: '图书馆三楼' });
      clock.store.markDone(b.id);
      var titles = clock.store.queryPosts({ location: '图书馆' }).map(function (x) { return x.title; });
      assert.deepEqual(titles, ['较早的信息', '较新的信息'], '两条都命中"图书馆"，已完成的那条沉底');
    });
  });

  /* ============================================================
   * 四、隐私出口（6 条）★ 本项目最该守住的一组
   * 断言的是"数据里没有"，不是"界面没显示"
   * ============================================================ */

  describe('四、隐私出口', function () {
    function locked() {
      var store = T.makeStore();
      return { store: store, id: T.withPost(store, T.ME, {}).id };
    }

    it('★ 下发的题目里没有 answer，整个 JSON 序列化后也搜不到', function () {
      var c = locked();
      var session = c.store.startClaim(c.id, T.OTHER);
      session.questions.forEach(function (q) { assert.isUndefined(q.answer); });
      assert.notInclude(JSON.stringify(session), 'answer');
    });

    it('★ 公开视图里根本没有 claims / appeals 这两个键', function () {
      var c = locked();
      var view = c.store.getPost(c.id, T.OTHER);
      assert.notProperty(view, 'claims');
      assert.notProperty(view, 'appeals');
    });

    it('★ 未解锁时 contactWay 是空串，而不是被前端藏起来的文本', function () {
      var c = locked();
      var view = c.store.getPost(c.id, T.OTHER);
      assert.strictEqual(view.contactWay, '');
      assert.isTrue(view.contactLocked);
      assert.notInclude(JSON.stringify(view), '5123678');
    });

    it('未解锁时姓名打码；发布者自己看得到完整姓名和联系方式', function () {
      var c = locked();
      assert.strictEqual(c.store.getPost(c.id, T.OTHER).contactName, '周**');
      var mine = c.store.getPost(c.id, T.ME);
      assert.strictEqual(mine.contactName, '周同学');
      assert.strictEqual(mine.contactWay, 'QQ 5123678');
    });

    it('寻物信息和「其他」类招领不许设门槛，联系方式直接可见', function () {
      var store = T.makeStore();
      var lost = T.withPost(store, T.ME, T.validLost());
      var trust = T.withPost(store, T.ME, { category: 'other', questions: [] });
      assert.strictEqual(store.getPost(lost.id, T.OTHER).contactWay, '13800138000');
      assert.strictEqual(store.getPost(trust.id, T.OTHER).contactWay, 'QQ 5123678');
    });

    it('★ 绕过界面直接调数据层也改不动受保护字段（id / 编号 / 浏览量 / 归属 / 状态）', function () {
      var c = locked();
      var before = c.store.getPost(c.id);
      var res = c.store.updatePost(c.id, {
        id: 'hacked', code: 'HACKED', ownerId: 'hacker',
        views: 99999, status: LF.STATUSES.DONE, attemptsLeft: 999
      }, T.ME);
      assert.isTrue(res.ok, '受保护字段应被静默剔除，而不是让整次更新失败');
      var after = c.store.getPost(c.id);
      assert.strictEqual(after.id, before.id);
      assert.strictEqual(after.code, before.code);
      assert.strictEqual(after.views, before.views);
      assert.strictEqual(after.status, before.status);
      assert.strictEqual(after.attemptsLeft, before.attemptsLeft);
    });
  });

  /* ============================================================
   * 五、认领验证（10 条）★ 核心机制
   * ============================================================ */

  describe('五、认领验证', function () {
    function locked() {
      var store = T.makeStore();
      return { store: store, id: T.withPost(store, T.ME, {}).id };
    }
    function exhaust(c) {
      for (var i = 0; i < LF.VERIFY.MAX_ATTEMPTS; i++) {
        c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER);
      }
    }

    it('取题时一次性下发全部题目，且不含正确答案', function () {
      var c = locked();
      var s = c.store.startClaim(c.id, T.OTHER);
      assert.isTrue(s.ok);
      assert.lengthOf(s.questions, 3);
      assert.strictEqual(s.attemptsLeft, LF.VERIFY.MAX_ATTEMPTS);
      assert.strictEqual(s.contactName, '周**', '取题页的发布者姓名也是打码的');
    });

    it('★ 没答完就提交：提示还差几题，且不消耗次数', function () {
      var c = locked();
      var res = c.store.submitClaim(c.id, [0, null, 1], T.OTHER);
      assert.isFalse(res.ok);
      assert.include(res.message, '还有 1 道题没有作答');
      assert.strictEqual(c.store.getPost(c.id).attemptsLeft, LF.VERIFY.MAX_ATTEMPTS, '次数不变');
    });

    it('答错时扣一次次数，且只回一句统一提示', function () {
      var c = locked();
      var res = c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER);
      assert.isTrue(res.ok);
      assert.isFalse(res.passed);
      assert.strictEqual(res.message, '回答的细节与描述不符');
      assert.strictEqual(res.remaining, LF.VERIFY.MAX_ATTEMPTS - 1);
    });

    it('★ 全错和只错一题，返回给前端的东西必须一模一样', function () {
      var c1 = locked();
      var allWrong = c1.store.submitClaim(c1.id, T.wrongAnswers(), T.OTHER);

      var c2 = locked();
      var onlyOneWrong = T.correctAnswers();
      onlyOneWrong[0] = 1 - onlyOneWrong[0];      // 只把第一题改错
      var oneWrong = c2.store.submitClaim(c2.id, onlyOneWrong, T.OTHER);

      assert.deepEqual(Object.keys(allWrong).sort(), Object.keys(oneWrong).sort(),
        '两种失败情况返回的键集合必须完全一致');
      assert.strictEqual(JSON.stringify(allWrong), JSON.stringify(oneWrong),
        '否则前端就能从差异里推断出答对了几题，3 次机会变成"每次排除一题"');
    });

    it('全部答对即解锁联系方式，并生成 CL- 开头的凭证码', function () {
      var c = locked();
      var res = c.store.submitClaim(c.id, T.correctAnswers(), T.OTHER);
      assert.isTrue(res.passed);
      assert.match(res.voucher, /^CL-\d{4}-\d{4}$/);
      var view = c.store.getPost(c.id, T.OTHER);
      assert.strictEqual(view.contactWay, 'QQ 5123678');
      assert.strictEqual(view.lockState, 'unlocked');
    });

    it('答对不消耗次数', function () {
      var c = locked();
      c.store.submitClaim(c.id, T.correctAnswers(), T.OTHER);
      assert.strictEqual(c.store.getPost(c.id).attemptsLeft, LF.VERIFY.MAX_ATTEMPTS);
    });

    it('每次失败扣一次，扣到 0 为止', function () {
      var c = locked();
      assert.strictEqual(c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER).remaining, 2);
      assert.strictEqual(c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER).remaining, 1);
      assert.strictEqual(c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER).remaining, 0);
    });

    it('★ 次数没用完时不能申诉；答满 3 次后申诉入口才打开', function () {
      var c = locked();
      assert.isFalse(c.store.getPost(c.id, T.OTHER).canAppeal);
      c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER);
      c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER);
      assert.isFalse(c.store.getPost(c.id, T.OTHER).canAppeal, '还剩 1 次，不该出现申诉入口');
      c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER);
      assert.isTrue(c.store.getPost(c.id, T.OTHER).canAppeal);
    });

    it('次数用完后即使答对也不能再提交', function () {
      var c = locked();
      exhaust(c);
      var res = c.store.submitClaim(c.id, T.correctAnswers(), T.OTHER);
      assert.isFalse(res.ok);
      assert.include(res.message, '申诉');
      assert.strictEqual(c.store.getPost(c.id, T.OTHER).contactWay, '');
    });

    it('发布者换了题目之后，作答次数重置为满', function () {
      var c = locked();
      c.store.submitClaim(c.id, T.wrongAnswers(), T.OTHER);
      assert.strictEqual(c.store.getPost(c.id).attemptsLeft, 2);
      var newQuestions = [
        { type: 'judge', stem: '雨伞是自动伞', answer: 0 },
        { type: 'judge', stem: '伞套还在', answer: 1 },
        { type: 'choice', stem: '伞面颜色是', options: ['藏蓝', '墨绿', '黑色'], answer: 0 }
      ];
      var res = c.store.updatePost(c.id, { questions: newQuestions }, T.ME);
      assert.isTrue(res.ok);
      assert.strictEqual(res.post.attemptsLeft, LF.VERIFY.MAX_ATTEMPTS);
    });
  });

  /* ============================================================
   * 六、申诉与人工审核（4 条）
   * ============================================================ */

  describe('六、申诉与人工审核', function () {
    var OK = {
      claimantName: '陈雨桐', contact: 'QQ 8845123',
      detail: '伞柄是木头的，伞骨八根，伞面上有一道修补痕迹'
    };
    function exhausted() {
      var store = T.makeStore();
      var id = T.withPost(store, T.ME, {}).id;
      for (var i = 0; i < LF.VERIFY.MAX_ATTEMPTS; i++) {
        store.submitClaim(id, T.wrongAnswers(), T.OTHER);
      }
      return { store: store, id: id };
    }

    it('次数还没用完时提交申诉会被拒，并提示还剩几次', function () {
      var store = T.makeStore();
      var id = T.withPost(store, T.ME, {}).id;
      store.submitClaim(id, T.wrongAnswers(), T.OTHER);
      var res = store.submitAppeal(id, OK, T.OTHER);
      assert.isFalse(res.ok);
      assert.include(res.message, '还剩');
    });

    it('细节描述过短被拒（挡住"就是我的"这类无信息量的申诉）', function () {
      var c = exhausted();
      var res = c.store.submitAppeal(c.id, T.merge(OK, { detail: '我的' }), T.OTHER);
      assert.isFalse(res.ok);
      assert.isString(res.errors.detail);
    });

    it('★ 申诉明细只有发布者能看（非发布者调 listAppeals 被拒）', function () {
      var c = exhausted();
      c.store.submitAppeal(c.id, OK, T.OTHER);
      assert.isFalse(c.store.listAppeals(c.id, T.OTHER).ok);
      assert.lengthOf(c.store.listAppeals(c.id, 'somebody_else').appeals, 0);
      assert.lengthOf(c.store.listAppeals(c.id, T.ME).appeals, 1);
    });

    it('★ 发布者同意交还后解锁联系方式并生成线下交接编号；驳回则保持锁定', function () {
      var c1 = exhausted();
      var a1 = c1.store.submitAppeal(c1.id, OK, T.OTHER).appeal;
      var accepted = c1.store.resolveAppeal(c1.id, a1.id, 'accepted', '', T.ME);
      assert.isTrue(accepted.ok);
      assert.match(accepted.appeal.voucher, /^CL-\d{4}-\d{4}$/);
      assert.strictEqual(c1.store.getPost(c1.id, T.OTHER).contactWay, 'QQ 5123678');

      var c2 = exhausted();
      var a2 = c2.store.submitAppeal(c2.id, OK, T.OTHER).appeal;
      var rejected = c2.store.resolveAppeal(c2.id, a2.id, 'rejected', '你描述的划痕和实物不一致', T.ME);
      assert.isTrue(rejected.ok);
      assert.strictEqual(c2.store.getPost(c2.id, T.OTHER).contactWay, '', '驳回后仍然锁着');
      assert.strictEqual(c2.store.listAppeals(c2.id, T.ME).appeals[0].note, '你描述的划痕和实物不一致');
    });
  });

  /* ============================================================
   * 七、状态流转（3 条）
   * ============================================================ */

  describe('七、状态流转', function () {
    it('寻物标记后文案变「已找到」、招领变「已归还」', function () {
      var store = T.makeStore();
      var lost = T.withPost(store, T.ME, T.validLost());
      var found = T.withPost(store, T.ME, {});
      assert.strictEqual(store.markDone(lost.id).post.statusText, '已找到');
      assert.strictEqual(store.markDone(found.id).post.statusText, '已归还');
    });

    it('★ 标记是幂等的：重复调用不改动原有的完成时间', function () {
      var clock = T.makeClockStore();
      var id = T.withPost(clock.store, T.ME, {}).id;
      var first = clock.store.markDone(id);
      clock.tick(60 * 60 * 1000);          // 一小时后有人又点了一次
      var second = clock.store.markDone(id);
      assert.isTrue(second.unchanged);
      assert.strictEqual(second.post.doneAt, first.post.doneAt,
        '否则「已归还于昨天」会变成「已归还于刚才」，记录就不准了');
    });

    it('★ 不是自己的信息一概改不动（权限校验在数据层，不靠按钮显不显示）', function () {
      var store = T.makeStore();
      var id = T.withPost(store, T.ME, {}).id;
      assert.isFalse(store.markDone(id, T.OTHER).ok);
      assert.isFalse(store.updatePost(id, { title: '被篡改的标题' }, T.OTHER).ok);
      assert.isFalse(store.removePost(id, T.OTHER).ok);
      assert.isFalse(store.restorePost(id, T.OTHER).ok);
      assert.strictEqual(store.getPost(id).title, '藏蓝色三折雨伞');
      assert.isNotNull(store.getPost(id));
    });
  });

  /* ============================================================
   * 八、存储与容错（3 条）
   * ============================================================ */

  describe('八、存储与容错', function () {
    it('存了半截 JSON / 非数组 / 混入 null 时不会崩，坏的丢掉好的留下', function () {
      var adapter = LF.createMemoryAdapter();
      adapter.setItem(LF.STORAGE_KEY, '{"version":1,"posts":[{');
      assert.doesNotThrow(function () {
        var s = LF.createStore(adapter, { now: T.NOW, ownerId: T.ME, seed: false });
        s.boot();
      });

      var adapter2 = LF.createMemoryAdapter();
      adapter2.setItem(LF.STORAGE_KEY, JSON.stringify({
        version: 1,
        posts: [null, '字符串', { title: '没有 id' }, {
          id: 'ok_1', type: 'lost', title: '一条正常的信息', category: 'daily',
          location: '食堂', happenedAt: '2026-10-01', contactName: '某人',
          contactWay: '13800138000', createdAt: T.NOW
        }]
      }));
      var s2 = LF.createStore(adapter2, { now: T.NOW, ownerId: T.ME, seed: false });
      s2.boot();
      assert.strictEqual(s2.countPosts({}), 1);
      assert.strictEqual(s2.queryPosts({})[0].title, '一条正常的信息');
    });

    it('★ 存储写满时返回中文的可操作提示，而不是抛异常', function () {
      var store = LF.createStore(T.quotaAdapter(), { now: T.NOW, ownerId: T.ME, seed: false });
      store.boot();
      var res = store.createPost(T.validLost());
      assert.isFalse(res.ok);
      assert.include(res.errors._, '写满');
      assert.strictEqual(store.countPosts({}), 0, '落盘失败时内存里也不留下这条记录');
    });

    it('★ 第一次结对作业那份脚手架的数据能被迁移过来', function () {
      var adapter = LF.createMemoryAdapter();
      adapter.setItem(LF.LEGACY_STORAGE_KEY, JSON.stringify([
        { id: 1, type: 'lost', name: '黑色校园卡', place: '图书馆三楼', desc: '卡面有贴纸',
          contact: '13800138000', createTime: '2026/09/20 10:00:00', status: 'ongoing' }
      ]));
      var store = LF.createStore(adapter, { now: T.NOW, ownerId: T.ME, seed: false });
      var res = store.boot();
      assert.strictEqual(res.migrated, 1);
      var view = store.queryPosts({ keyword: '校园卡' })[0];
      assert.strictEqual(view.title, '黑色校园卡');
      assert.strictEqual(view.location, '图书馆三楼');
    });
  });

  /* ============================================================
   * 九、端到端串联（2 条）
   * 单模块测试都过、拼起来却出问题，是结对开发里很常见的情况
   * ============================================================ */

  describe('九、端到端串联', function () {
    it('★ 主流程一次走通：发布 → 搜索 → 详情 → 认领 → 联系 → 更新状态', function () {
      var clock = T.makeClockStore();
      var store = clock.store;

      /* 1. 发布一条带验证题的招领信息 */
      var created = store.createPost({
        type: 'found', title: '白色蓝牙耳机一副', category: 'digital',
        location: '图书馆三楼自习区靠窗那排', happenedAt: '2026-10-08',
        description: '自习位捡到的，耳机盒有点脏。',
        contactName: '林同学', contactWay: '微信 linfeng_2023',
        questions: [
          { type: 'judge', stem: '耳机盒外壳有划痕', answer: 0 },
          { type: 'choice', stem: '耳机盒的充电口是', options: ['Type-C', 'Lightning'], answer: 1 },
          { type: 'judge', stem: '盒子上贴有贴纸', answer: 1 }
        ]
      }, T.ME);
      assert.isTrue(created.ok, JSON.stringify(created.errors));
      var id = created.post.id;
      assert.match(created.post.code, /^LF\d{11}$/);

      /* 2. 别人能在列表和搜索里看到它 */
      assert.lengthOf(store.queryPosts({ keyword: '蓝牙耳机' }), 1);
      assert.lengthOf(store.queryPosts({ keyword: '图书馆 耳机' }), 1);

      /* 3. 打开详情：看得到描述，看不到联系方式，也看不到答案 */
      var detail = store.getPost(id, T.OTHER);
      assert.strictEqual(detail.contactWay, '');
      assert.isTrue(detail.contactLocked);
      assert.notInclude(JSON.stringify(detail), 'answer');

      /* 4. 第一次故意答错：只拿到统一提示，扣一次次数 */
      var wrong = store.submitClaim(id, [1, 0, 0], T.OTHER);
      assert.isFalse(wrong.passed);
      assert.strictEqual(wrong.message, '回答的细节与描述不符');
      assert.strictEqual(store.getPost(id, T.OTHER).contactWay, '');

      /* 5. 第二次全答对：解锁联系方式并拿到凭证码 */
      var right = store.submitClaim(id, [0, 1, 1], T.OTHER);
      assert.isTrue(right.passed);
      assert.match(right.voucher, /^CL-\d{4}-\d{4}$/);
      assert.strictEqual(store.getPost(id, T.OTHER).contactWay, '微信 linfeng_2023');

      /* 6. 发布者标记已归还 */
      var done = store.markDone(id, T.ME);
      assert.strictEqual(done.post.statusText, '已归还');

      /* 7. 统计对得上 */
      var stats = store.getStats(T.ME);
      assert.strictEqual(stats.total, 1);
      assert.strictEqual(stats.done, 1);
      assert.strictEqual(stats.claims, 2);
    });

    it('★ 3 次全败 → 申诉 → 同意交还，整条人工审核链路走通', function () {
      var clock = T.makeClockStore();
      var store = clock.store;
      var id = store.createPost({
        type: 'found', title: '藏蓝色折叠雨伞', category: 'rain',
        location: '第二食堂门口伞架', happenedAt: '2026-10-05',
        description: '雨天之后挂在伞架上没人拿。', contactName: '周同学', contactWay: 'QQ 5123678',
        questions: [
          { type: 'judge', stem: '伞柄是木头的', answer: 0 },
          { type: 'choice', stem: '伞骨有几根', options: ['6 根', '8 根'], answer: 1 },
          { type: 'judge', stem: '伞面有修补痕迹', answer: 0 }
        ]
      }, T.ME).post.id;

      /* 连续答错 3 次 */
      for (var i = 1; i <= LF.VERIFY.MAX_ATTEMPTS; i++) {
        clock.tick();
        var res = store.submitClaim(id, [1, 0, 1], T.OTHER);
        assert.isFalse(res.passed);
        assert.strictEqual(res.remaining, LF.VERIFY.MAX_ATTEMPTS - i);
      }
      var exhausted = store.getPost(id, T.OTHER);
      assert.isTrue(exhausted.canAppeal);
      assert.strictEqual(exhausted.contactWay, '');

      /* 提交申诉 */
      clock.tick();
      var appeal = store.submitAppeal(id, {
        claimantName: '陈雨桐', contact: 'QQ 8845123',
        detail: '伞柄是木头的，伞骨八根，伞面上有一处我自己补过的痕迹，用的是深蓝色线'
      }, T.OTHER);
      assert.isTrue(appeal.ok, JSON.stringify(appeal.errors));
      assert.isFalse(store.getPost(id, T.OTHER).canAppeal, '已提交过就不再重复开放入口');
      assert.notInclude(JSON.stringify(store.queryPosts({})), '8845123', '申诉人的联系方式不该出现在公开视图里');

      /* 发布者同意交还 */
      var list = store.listAppeals(id, T.ME);
      assert.lengthOf(list.appeals, 1);
      var decided = store.resolveAppeal(id, list.appeals[0].id, 'accepted', '细节对得上，同意交还', T.ME);
      assert.isTrue(decided.ok);

      /* 认领人拿到联系方式与线下交接编号 */
      var finalView = store.getPost(id, T.OTHER);
      assert.strictEqual(finalView.contactWay, 'QQ 5123678');
      assert.strictEqual(finalView.voucher, decided.appeal.voucher);
      assert.strictEqual(store.getStats(T.ME).pendingAppeals, 0);
    });
  });
  /* ============================================================
   * 十、基础工具与演示数据（3 条）
   * ------------------------------------------------------------
   * 这一组是"覆盖率反查"补出来的：精简用例之后重跑一遍覆盖率，
   * 发现 seed.js 几乎没被执行到（演示数据从没被验证过），
   * 而 escapeHtml / highlight 这两个防 XSS 的函数也没被单独测。
   * 前者会让"演示数据坏掉"这种事在测试全绿的情况下溜到用户手里，
   * 后者是安全相关的函数，不能只靠间接调用来保证。
   * ============================================================ */

  describe('十、基础工具与演示数据', function () {
    it('★ 用户输入的 HTML 会被转义，高亮也先转义再包标签（防 XSS）', function () {
      assert.strictEqual(LF.escapeHtml('<img src=x onerror=alert(1)>'),
        '&lt;img src=x onerror=alert(1)&gt;');
      assert.strictEqual(LF.escapeHtml('a & b'), 'a &amp; b');
      assert.strictEqual(LF.escapeHtml(null), '');

      var out = LF.highlight('<script>alert(1)</script>', 'script');
      assert.notInclude(out, '<script', '原始标签必须被转义');
      assert.include(out, '<mark class="hl">script</mark>', '命中片段仍然要高亮');
    });

    it('相对时间的几种说法与非法输入兜底', function () {
      assert.strictEqual(LF.timeAgo(T.NOW - 10 * 1000, { now: T.NOW }), '刚刚');
      assert.strictEqual(LF.timeAgo(T.NOW - 5 * 60 * 1000, { now: T.NOW }), '5 分钟前');
      assert.strictEqual(LF.timeAgo(T.NOW - 3 * 3600 * 1000, { now: T.NOW }), '3 小时前');
      assert.strictEqual(LF.timeAgo(T.NOW - 2 * 24 * 3600 * 1000, { now: T.NOW }), '2 天前');
      assert.strictEqual(LF.timeAgo('这不是时间', { now: T.NOW }), '', '非法输入返回空串而不是 Invalid Date');
    });

    it('★ 首次打开能灌入演示数据，且每一条都能通过当前的发布校验', function () {
      var store = T.seededStore();
      assert.isAtLeast(store.countPosts({}), 8, '首页不能是空的');
      assert.isAtLeast(store.getMyPosts().length, 2, '要有属于本机的条目，否则「我的发布」是空的');

      // 演示数据本身必须合法——否则说明夹具和规则已经脱节了
      LF.buildSeedPosts(T.NOW, T.ME).forEach(function (p) {
        var qs = p.questions.map(function (q) {
          return { type: q.type, stem: q.stem, options: q.options, answer: q.answer };
        });
        var r = LF.validatePost({
          type: p.type, title: p.title, category: p.category, location: p.location,
          happenedAt: p.happenedAt, description: p.description,
          contactName: p.contactName, contactWay: p.contactWay, photo: p.photo,
          questions: qs, now: T.NOW
        });
        assert.isTrue(r.ok, '演示数据「' + p.title + '」不合法：' + JSON.stringify(r.errors));
      });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
