/**
 * 葫芦侠智能抓取 + 签到 (无表情，详细通知，无拦截)
 * 版本：13.0

[rewrite_local]
# 匹配所有 floor.huluxia.com 请求，仅读取 body 不修改
^https:\/\/floor\.huluxia\.com\/.* url script-request-body http://raw.githubusercontent.com/yr123466/huluxia/refs/heads/main/huluxia_all.js

[task_local]
0 7,11,17 * * * http://raw.githubusercontent.com/yr123466/huluxia/refs/heads/main/huluxia_all.js, tag=葫芦侠签到, enabled=true

[MITM]
hostname = floor.huluxia.com

 */

/************ 配置区 ************/
const CATEGORY_LIST = [
    1, 2, 3, 4, 6, 15, 16, 22, 29,
    43, 44, 45, 57, 58, 60, 63, 67, 68,
    69, 70, 71, 76, 81, 82, 84, 92, 94,
    96, 98, 108, 111, 115, 119, 125,
    126, 127, 128, 129
];
const CAT_DELAY = 1500;
const MAX_RETRY = 2;
/********************************/

const isRewrite = typeof $request !== "undefined" && $request.body !== undefined;

if (isRewrite) {
    // ================= 重写：不拦截，仅读取并存储 =================
    try {
        const body = $request.body || "";
        if (body.includes('_key=')) {
            const getParam = (str, name) => {
                const match = str.match(new RegExp(`(?:^|&)${name}=([^&]+)`));
                return match ? match[1] : null;
            };
            const _key = getParam(body, '_key');
            const user_id = getParam(body, 'user_id');
            const device_code = getParam(body, 'device_code');
            const ua = $request.headers['User-Agent'] || $request.headers['user-agent'] || "";

            if (_key && _key.length > 40) {
                const prevRaw = $prefs.valueForKey("huluxia_auth");
                let prev = {};
                if (prevRaw) {
                    try { prev = JSON.parse(prevRaw); } catch (e) {}
                }

                const newAuth = {
                    _key: _key,
                    user_id: user_id || prev.user_id || "",
                    device_code: device_code || prev.device_code || "",
                    ua: ua || prev.ua || "Floor/1.2.2",
                    updated: Date.now()
                };

                $prefs.setValueForKey(JSON.stringify(newAuth), "huluxia_auth");

                if (!prev._key) {
                    $notify("Key 已捕获", `用户ID: ${newAuth.user_id || "未知"}`, `密钥: ${_key.slice(0,12)}...`);
                } else if (prev._key !== _key) {
                    $notify("Key 已自动更新", `用户ID: ${newAuth.user_id || "未知"}`, `新密钥: ${_key.slice(0,12)}...`);
                }
            }
        }
    } catch (e) {
        // 静默处理，确保不影响请求
    }
    $done({});   // 立即放行

} else {
    // ================= 定时任务：签到 =================
    (async () => {
        try {
            await executeSign();
        } catch (e) {
            $notify("脚本崩溃", e.message, "请检查网络后重试");
            $done();
        }
    })();
}

async function executeSign() {
    const raw = $prefs.valueForKey("huluxia_auth");
    if (!raw) {
        $notify("未找到认证数据", "请打开葫芦侠App，任意操作即可自动抓取");
        $done();
        return;
    }
    let auth;
    try { auth = JSON.parse(raw); } catch (e) { $notify("认证数据解析失败", ""); $done(); return; }

    const { _key, user_id: uid, device_code: device, ua } = auth;
    if (!_key || _key.length < 40) {
        $notify("密钥无效", "请打开App，脚本将自动捕获最新key");
        $done();
        return;
    }
    if (!device) {
        $notify("缺少 device_code", "请重启App以触发抓取");
        $done();
        return;
    }

    console.log(`账号: ${uid}`);
    console.log(`设备码: ${device.slice(0,8)}...`);

    const userInfo = await getUserInfo(_key, uid, device, ua);
    if (!userInfo) {
        $notify("Key 可能已失效", "获取用户信息失败", "请打开App，脚本将自动捕获新key");
        $done();
        return;
    }
    const nick = userInfo.nick || "未知";
    const level = userInfo.level || 0;
    const expBefore = userInfo.exp || 0;
    console.log(`用户: ${nick} Lv.${level}`);

    console.log(`签到板块共 ${CATEGORY_LIST.length} 个`);
    let success = 0, totalExp = 0;
    const failedCats = [];

    for (let i = 0; i < CATEGORY_LIST.length; i++) {
        const catId = CATEGORY_LIST[i];
        const res = await signOne(_key, uid, device, ua, catId);
        if (res && (res.status === 1 || res.signin === 1)) {
            success++;
            totalExp += (res.experienceVal || 0);
            console.log(`[成功] 板块${catId} +${res.experienceVal||0}`);
        } else {
            failedCats.push(catId);
            console.log(`[失败] 板块${catId}`);
        }
        if (i < CATEGORY_LIST.length - 1) await sleep(CAT_DELAY);
    }

    const after = await getUserInfo(_key, uid, device, ua);
    const expGained = after ? (after.exp || 0) - expBefore : 0;
    const continueDays = after && after.continueDays ? after.continueDays : null;

    // 生成详细通知
    let title = "葫芦侠签到完成";
    let subtitle = `成功 ${success}/${CATEGORY_LIST.length} | 经验 +${totalExp}`;
    let detail = `用户: ${nick} Lv.${after?.level || level}\n`;
    detail += `签到: ${success}/${CATEGORY_LIST.length} 板块\n`;
    detail += `获得经验: +${totalExp}\n`;
    if (expGained !== 0) {
        detail += `经验变化: ${expGained >= 0 ? '+' : ''}${expGained}\n`;
    }
    if (continueDays !== null) {
        detail += `连续签到: ${continueDays} 天\n`;
    }
    if (failedCats.length > 0) {
        detail += `失败板块: ${failedCats.join(', ')}\n`;
    }
    detail += `时间: ${new Date().toLocaleString()}`;

    $notify(title, subtitle, detail);
    $done();
}

// ==================== 网络请求 ====================
async function signOne(key, uid, device, ua, catId) {
    const body = `_key=${key}&user_id=${uid}&cat_id=${catId}&device_code=${device}&app_version=1.2.2&market_id=floor_huluxia&platform=1`;
    for (let retry = 0; retry <= MAX_RETRY; retry++) {
        try {
            const resp = await $task.fetch({
                url: "https://floor.huluxia.com/user/signin/IOS/1.1",
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": ua
                },
                body: body,
                timeout: 15
            });
            const data = typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body;
            if (data && data.code === 103) return null;
            return data;
        } catch (e) {
            if (retry < MAX_RETRY) {
                console.log(`板块${catId}第${retry+1}次重试`);
                await sleep(5000);
            }
        }
    }
    return null;
}

async function getUserInfo(key, uid, device, ua) {
    const body = `_key=${key}&user_id=${uid}&device_code=${device}&app_version=1.2.2&market_id=floor_huluxia&platform=1`;
    try {
        const resp = await $task.fetch({
            url: "https://floor.huluxia.com/user/info/IOS/1.1",
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": ua
            },
            body: body,
            timeout: 10
        });
        return typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body;
    } catch (e) {
        return null;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}