(function () {
  const safe = (f, d) => {
    try {
      const r = f();
      return r === undefined ? d : r;
    } catch {
      return d;
    }
  };

  const { registerCommand } = vendetta.commands;
  const { findByProps, findByStoreName } = vendetta.metro;
  const { storage } = vendetta.plugin;

  const RestAPI = safe(() => findByProps("getAPIBaseURL", "get", "patch"));
  const UserStore = safe(() => findByStoreName("UserStore"));
  const UserProfileStore = safe(() => findByStoreName("UserProfileStore"));
  const SelectedChannelStore = safe(() => findByStoreName("SelectedChannelStore"));
  const SelectedGuildStore = safe(() => findByStoreName("SelectedGuildStore"));
  const BotMsg = safe(() => findByProps("sendBotMessage"));
  const CreateMsg = safe(() => findByProps("createBotMessage"));
  const MessageActions = safe(() => findByProps("receiveMessage", "sendMessage"));
  const Flux = safe(() => findByProps("dispatch", "subscribe"));
  const patcher = safe(() => vendetta.patcher);

  storage.profiles ??= {};

  const toast = (t) =>
    safe(() => vendetta.ui.toasts.showToast(String(t).slice(0, 120)));

  const msg = (channelId, text) => {
    try {
      if (BotMsg?.sendBotMessage) return BotMsg.sendBotMessage(channelId, text);
    } catch {}
    toast(text);
  };

  const errText = (e) => {
    try {
      const b = e?.body ?? e;
      return `${e?.status ?? ""} ${JSON.stringify(b) ?? e?.message ?? e}`.slice(0, 500);
    } catch {
      return String(e);
    }
  };

  const clean = (o) =>
    Object.fromEntries(
      Object.entries(o).filter(([, v]) => v !== null && v !== undefined)
    );

  const ext = (hash) => (String(hash).startsWith("a_") ? "gif" : "png");

  const toDataURI = async (url) => {
    const blob = await (await fetch(url)).blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  };

  // ===== الافكت =====
  const effId = (e) => e?.sku_id ?? e?.skuId ?? e?.id ?? null;

  const readEffect = (body, userId, guildId) => {
    const p = body.guild_member_profile ?? {};
    const up = body.user_profile ?? {};
    const sg = safe(() => UserProfileStore?.getGuildMemberProfile?.(userId, guildId));
    const su = safe(() => UserProfileStore?.getUserProfile?.(userId));
    return (
      effId(p.profile_effect) ??
      p.profile_effect_id ??
      effId(up.profile_effect) ??
      up.profile_effect_id ??
      effId(sg?.profileEffect) ??
      sg?.profileEffectId ??
      effId(su?.profileEffect) ??
      su?.profileEffectId ??
      null
    );
  };

  // ===== الديكوريشن (خاص بالسيرفر فقط) =====
  const readGuildDecoration = (body) => {
    const src = body.guild_member?.avatar_decoration_data ?? null;
    if (!src?.asset) return null;
    return { asset: src.asset, sku_id: src.sku_id ?? src.skuId ?? null };
  };

  const readGlobalDecoration = (body, userId) => {
    const src =
      body.user?.avatar_decoration_data ??
      safe(() => UserStore?.getUser?.(userId)?.avatarDecorationData) ??
      null;
    return src?.asset ? { asset: src.asset, sku_id: src.sku_id ?? src.skuId ?? null } : null;
  };

  // ===== بناء البيانات =====
  const buildData = async (body, userId, guildId, withNick) => {
    const p = body.guild_member_profile ?? {};
    const m = body.guild_member ?? {};
    const u = body.user ?? {};
    const up = body.user_profile ?? {};

    let avatarUrl = null;
    let avatarSrc = "ما فيه";
    const avatarHash = u.avatar ?? UserStore?.getUser?.(userId)?.avatar;
    if (m.avatar) {
      avatarUrl = `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${m.avatar}.${ext(m.avatar)}?size=1024`;
      avatarSrc = "خاص بالسيرفر";
    } else if (avatarHash) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext(avatarHash)}?size=1024`;
      avatarSrc = "عام";
    }

    let bannerUrl = null;
    if (p.banner) {
      bannerUrl = `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/banners/${p.banner}.${ext(p.banner)}?size=1024`;
    } else if (u.banner ?? up.banner) {
      const bh = u.banner ?? up.banner;
      bannerUrl = `https://cdn.discordapp.com/banners/${userId}/${bh}.${ext(bh)}?size=1024`;
    }

    const data = {
      bio: p.bio ?? up.bio ?? "",
      pronouns: p.pronouns ?? up.pronouns ?? "",
      accent_color: p.accent_color ?? up.accent_color ?? u.accent_color ?? null,
      theme_colors: p.theme_colors ?? up.theme_colors ?? null,
      profile_effect_id: readEffect(body, userId, guildId),
      avatar_decoration: readGuildDecoration(body),
      nick: withNick ? m.nick ?? null : null,
      avatarUrl,
      bannerUrl,
      avatar: avatarUrl ? await toDataURI(avatarUrl) : null,
      banner: bannerUrl ? await toDataURI(bannerUrl) : null,
    };
    return { data, avatarSrc };
  };

  const fetchProfile = (userId, guildId) =>
    RestAPI.get({
      url: `/users/${userId}/profile?with_mutual_guilds=false&guild_id=${guildId}`,
    });

  const currentEffect = async (guildId) => {
    const me = UserStore.getCurrentUser();
    const r = await fetchProfile(me.id, guildId);
    return readEffect(r.body, me.id, guildId);
  };

  const savedSummary = (data, avatarSrc) =>
    `الأفتار: ${avatarSrc}\nالبنر: ${data.banner ? "انحفظ" : "ما فيه"}\nالافكت: ${data.profile_effect_id ? "انحفظ" : "ما لقيت افكت"}\nالديكوريشن: ${data.avatar_decoration ? "انحفظ" : "ما لقيت ديكوريشن للسيرفر"}`;

  // ===== التطبيق =====
  const applyProfile = async (d, guildId) => {
    const notes = [];

    if (d.nick) {
      try {
        await RestAPI.patch({
          url: `/guilds/${guildId}/members/@me`,
          body: { nick: d.nick },
        });
      } catch (e) {
        if (e?.body?.code !== 50013) notes.push("النك نيم: " + errText(e));
      }
    }

    if (d.avatar) {
      try {
        await RestAPI.patch({
          url: `/guilds/${guildId}/members/@me`,
          body: { avatar: d.avatar },
        });
      } catch (e) {
        notes.push(
          JSON.stringify(e?.body ?? "").includes("AVATAR_RATE_LIMIT")
            ? "الأفتار: ديسكورد يحدّ التغيير، جرّب بعد 10-15 دقيقة"
            : "الأفتار: " + errText(e)
        );
      }
    } else {
      notes.push("الأفتار: ما انحفظ في هذا البروفايل");
    }

    // الديكوريشن: على بروفايل السيرفر فقط
    if (d.avatar_decoration?.asset) {
      const dec = d.avatar_decoration;
      const attempts = [
        {
          url: `/guilds/${guildId}/members/@me`,
          body: {
            avatar_decoration_id: dec.sku_id ?? dec.asset,
            avatar_decoration_sku_id: dec.sku_id,
          },
        },
        {
          url: `/guilds/${guildId}/members/@me`,
          body: { avatar_decoration_data: { asset: dec.asset, sku_id: dec.sku_id } },
        },
        {
          url: `/guilds/${guildId}/profile/@me`,
          body: {
            avatar_decoration_id: dec.sku_id ?? dec.asset,
            avatar_decoration_sku_id: dec.sku_id,
          },
        },
        {
          url: `/guilds/${guildId}/profile/@me`,
          body: { avatar_decoration_data: { asset: dec.asset, sku_id: dec.sku_id } },
        },
      ];
      let done = false;
      let lastErr = null;
      for (const a of attempts) {
        try {
          await RestAPI.patch({ url: a.url, body: clean(a.body) });
          const me = UserStore.getCurrentUser();
          const r = await fetchProfile(me.id, guildId);
          if (readGuildDecoration(r.body)?.asset === dec.asset) {
            done = true;
            break;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      if (!done) {
        notes.push(
          "الديكوريشن ما انطبق على السيرفر" +
            (lastErr ? ": " + errText(lastErr) : " (غالباً ما تملكه أو الـ endpoint مختلف)")
        );
      }
    } else {
      notes.push("الديكوريشن: ما انحفظ في هذا البروفايل");
    }

    try {
      await RestAPI.patch({
        url: `/guilds/${guildId}/profile/@me`,
        body: clean({
          bio: d.bio,
          pronouns: d.pronouns,
          banner: d.banner,
          accent_color: d.accent_color,
          theme_colors: d.theme_colors,
          profile_effect_id: d.profile_effect_id,
        }),
      });
    } catch (e) {
      notes.push("البنر/الألوان/الافكت: " + errText(e));
    }

    if (d.profile_effect_id) {
      try {
        let got = await currentEffect(guildId);
        if (got !== d.profile_effect_id) {
          try {
            await RestAPI.patch({
              url: `/guilds/${guildId}/profile/@me`,
              body: { profile_effect_id: d.profile_effect_id },
            });
          } catch (e) {
            notes.push("الافكت (إعادة): " + errText(e));
          }
          got = await currentEffect(guildId);
        }
        if (got !== d.profile_effect_id) {
          notes.push(`الافكت ما انطبق (المحفوظ ${d.profile_effect_id}، الحالي ${got ?? "ما فيه"})`);
        }
      } catch (e) {
        notes.push("فحص الافكت فشل: " + errText(e));
      }
    } else {
      notes.push("الافكت: ما انحفظ في هذا البروفايل");
    }

    return notes;
  };

  // ===== رسائل بأزرار (مع بديل نصي) =====
  const canButtons = !!(CreateMsg?.createBotMessage && MessageActions?.receiveMessage);

  const sendUI = (channelId, o) => {
    const m = CreateMsg.createBotMessage({
      channelId,
      content: o.content ?? "",
      embeds: o.embeds ?? [],
    });
    m.components = o.components ?? [];
    MessageActions.receiveMessage(channelId, m);
    return m;
  };

  const removeMsg = (channelId, id) => {
    try {
      if (id && Flux?.dispatch) Flux.dispatch({ type: "MESSAGE_DELETE", channelId, id });
    } catch {}
  };

  const btn = (label, id, style) => ({ type: 2, style: style ?? 1, label, custom_id: id });
  const row = (components) => ({ type: 1, components });

  const listText = () => {
    const names = Object.keys(storage.profiles);
    if (!names.length) return "ما عندك بروفايلات محفوظة.";
    return (
      `بروفايلاتك المحفوظة (${names.length}):\n` +
      names.map((n, i) => `${i + 1}. **${n}**`).join("\n")
    );
  };

  const showList = (channelId) => {
    const names = Object.keys(storage.profiles);
    if (!names.length) return msg(channelId, "ما عندك بروفايلات محفوظة.");
    if (!canButtons) return msg(channelId, listText());
    try {
      const shown = names.slice(0, 20);
      const rows = [];
      for (let i = 0; i < shown.length; i += 5) {
        rows.push(row(shown.slice(i, i + 5).map((n) => btn(n.slice(0, 80), "pr:open:" + n, 1))));
      }
      rows.push(row([btn("إغلاق", "pr:close", 2)]));
      sendUI(channelId, {
        content:
          "**بروفايلاتك** — اضغط على اسم عشان تشوفه" +
          (names.length > 20 ? `\n(تظهر أول 20 من ${names.length}، والباقي بـ /set_pr)` : ""),
        components: rows,
      });
    } catch (e) {
      msg(channelId, listText());
    }
  };

  const showPreview = (channelId, name) => {
    const d = storage.profiles[name];
    if (!d) return showList(channelId);
    const accent = d.theme_colors?.[1] != null ? d.theme_colors[1] : d.accent_color;
    const embed = {
      type: "rich",
      title: d.nick || name,
      description:
        (d.bio ? d.bio + "\n\n" : "") +
        [
          d.pronouns ? `الضمائر: ${d.pronouns}` : null,
          d.profile_effect_id ? "✨ فيه افكت" : null,
          d.avatar_decoration ? "🖼️ فيه ديكوريشن" : null,
        ]
          .filter(Boolean)
          .join(" • "),
      color: accent == null ? 0x5865f2 : Number(accent),
      footer: { text: `الاسم: ${name}` },
    };
    if (d.bannerUrl) embed.image = { url: d.bannerUrl, proxy_url: d.bannerUrl, width: 600, height: 240 };
    if (d.avatarUrl) embed.thumbnail = { url: d.avatarUrl, proxy_url: d.avatarUrl, width: 128, height: 128 };
    try {
      sendUI(channelId, {
        embeds: [embed],
        components: [
          row([
            btn("تطبيق", "pr:apply:" + name, 3),
            btn("حذف", "pr:del:" + name, 4),
            btn("رجوع", "pr:back", 2),
          ]),
        ],
      });
    } catch (e) {
      msg(channelId, "فشل عرض المعاينة: " + errText(e));
    }
  };

  const handleClick = async (customId, messageId, channelIdHint) => {
    try {
      const channelId = channelIdHint || SelectedChannelStore.getChannelId();
      const guildId = SelectedGuildStore.getGuildId();
      const [, act, ...rest] = String(customId).split(":");
      const name = rest.join(":");

      removeMsg(channelId, messageId);

      if (act === "open") return showPreview(channelId, name);
      if (act === "back") return showList(channelId);
      if (act === "close") return;

      if (act === "apply") {
        if (!guildId) return msg(channelId, "ادخل سيرفر أول.");
        const d = storage.profiles[name];
        if (!d) return msg(channelId, `ما لقيت بروفايل اسمه ${name}`);
        const notes = await applyProfile(d, guildId);
        return msg(channelId, `تم تطبيق **${name}** ✅` + (notes.length ? "\n" + notes.join("\n") : ""));
      }

      if (act === "del") {
        return sendUI(channelId, {
          content: `متأكد تبي تحذف **${name}**؟`,
          components: [
            row([btn("نعم، احذف", "pr:delok:" + name, 4), btn("إلغاء", "pr:open:" + name, 2)]),
          ],
        });
      }

      if (act === "delok") {
        delete storage.profiles[name];
        msg(channelId, `تم حذف **${name}** 🗑️`);
        return showList(channelId);
      }
    } catch (e) {
      toast("خطأ بالزر: " + errText(e));
    }
  };

  // ===== اعتراض ضغط الأزرار =====
  const patches = [];
  const hookInfo = [];
  const ours = new Set();
  const handled = new Set();

  const trigger = (id, messageId, channelId, nonce) => {
    const key = nonce ?? id + ":" + Math.floor(Date.now() / 1500);
    if (handled.has(key)) return;
    handled.add(key);
    setTimeout(() => handled.delete(key), 5000);
    handleClick(id, messageId, channelId);
  };

  hookInfo.push("patcher.instead: " + !!patcher?.instead);
  hookInfo.push("RestAPI: " + !!RestAPI);
  hookInfo.push("RestAPI.post: " + typeof RestAPI?.post);
  hookInfo.push("Flux.dispatch: " + typeof Flux?.dispatch);

  try {
    if (patcher?.instead) {
      const candidates = [
        RestAPI,
        safe(() => findByProps("getAPIBaseURL")),
        safe(() => findByProps("post", "patch", "get")),
      ].filter((x, i, a) => x && a.indexOf(x) === i && typeof x.post === "function");

      for (const mod of candidates) {
        patches.push(
          patcher.instead("post", mod, (args, orig) => {
            try {
              const a = args[0] ?? {};
              const url = String(a.url ?? "");
              const b = a.body ?? {};
              const id = b?.data?.custom_id;
              if (
                url.includes("/interactions") &&
                typeof id === "string" &&
                id.startsWith("pr:")
              ) {
                if (b.nonce) ours.add(b.nonce);
                trigger(id, b.message_id, b.channel_id, b.nonce);
                try {
                  Flux?.dispatch?.({ type: "INTERACTION_SUCCESS", nonce: b.nonce });
                } catch {}
                return Promise.resolve({
                  ok: true,
                  status: 204,
                  body: null,
                  headers: {},
                  text: "",
                });
              }
            } catch {}
            return orig(...args);
          })
        );
      }
      hookInfo.push("post hooks: " + candidates.length);

      if (Flux && typeof Flux.dispatch === "function") {
        patches.push(
          patcher.instead("dispatch", Flux, (args, orig) => {
            try {
              const ev = args[0] ?? {};
              if (ev.type === "INTERACTION_CREATE") {
                const cid = ev.data?.custom_id ?? ev.customId ?? ev.custom_id;
                if (typeof cid === "string" && cid.startsWith("pr:")) {
                  if (ev.nonce) ours.add(ev.nonce);
                  trigger(cid, ev.messageId ?? ev.message_id, ev.channelId ?? ev.channel_id, ev.nonce);
                }
              }
              if (
                (ev.type === "INTERACTION_FAILURE" || ev.type === "INTERACTION_TIMEOUT") &&
                ev.nonce &&
                ours.has(ev.nonce)
              ) {
                return;
              }
            } catch {}
            return orig(...args);
          })
        );
        hookInfo.push("flux hook: ok");
      }
    }
  } catch (e) {
    hookInfo.push("hook error: " + String(e?.message ?? e).slice(0, 100));
  }

  const hooked = patches.length > 0;

  // ===== الأوامر =====
  const getArg = (args, n) => args.find((a) => a.name === n)?.value;

  const wrapCmd = (fn) => async (args, ctx) => {
    try {
      await fn(args, ctx);
    } catch (e) {
      msg(ctx?.channel?.id, "خطأ: " + errText(e));
    }
  };

  const save = async (args, ctx) => {
    const name = getArg(args, "name");
    const guildId = ctx.guild?.id;
    const ch = ctx.channel.id;
    if (!guildId) return msg(ch, "ادخل سيرفر أول.");
    const me = UserStore.getCurrentUser();
    const res = await fetchProfile(me.id, guildId);
    const { data, avatarSrc } = await buildData(res.body, me.id, guildId, true);
    storage.profiles[name] = data;
    msg(ch, `تم حفظ البروفايل **${name}** ✅\n${savedSummary(data, avatarSrc)}`);
  };

  const apply = async (args, ctx) => {
    const name = getArg(args, "name");
    const guildId = ctx.guild?.id;
    const ch = ctx.channel.id;
    if (!guildId) return msg(ch, "ادخل سيرفر أول.");
    if (!name) return showList(ch);
    const d = storage.profiles[name];
    if (!d) return msg(ch, `ما لقيت بروفايل اسمه ${name}`);
    const notes = await applyProfile(d, guildId);
    msg(ch, `تم تطبيق **${name}** ✅` + (notes.length ? "\n" + notes.join("\n") : ""));
  };

  const show = async (args, ctx) => {
    const ch = ctx.channel.id;
    showList(ch);
    if (canButtons && !hooked) {
      msg(
        ch,
        "⚠️ ما قدرت أعترض ضغط الأزرار. استخدم /set_pr.\nتفاصيل للمطور:\n" +
          hookInfo.join("\n")
      );
    }
  };

  const rename = async (args, ctx) => {
    const ch = ctx.channel.id;
    const oldName = getArg(args, "name");
    const newName = getArg(args, "new_name");
    if (!storage.profiles[oldName]) return msg(ch, `ما لقيت بروفايل اسمه ${oldName}`);
    if (!newName) return msg(ch, "اكتب الاسم الجديد.");
    if (storage.profiles[newName]) return msg(ch, `فيه بروفايل بنفس الاسم **${newName}**`);
    storage.profiles[newName] = storage.profiles[oldName];
    delete storage.profiles[oldName];
    msg(ch, `تم تغيير الاسم من **${oldName}** إلى **${newName}** ✅`);
  };

  const del = async (args, ctx) => {
    const ch = ctx.channel.id;
    const name = getArg(args, "name");
    if (!storage.profiles[name]) return msg(ch, `ما لقيت بروفايل اسمه ${name}`);
    delete storage.profiles[name];
    msg(ch, `تم حذف **${name}** 🗑️`);
  };

  const stole = async (args, ctx) => {
    const userId = getArg(args, "user");
    const guildId = ctx.guild?.id;
    const ch = ctx.channel.id;
    if (!guildId) return msg(ch, "ادخل سيرفر أول.");
    if (!userId) return msg(ch, "حدد الشخص.");
    const name = getArg(args, "name") || UserStore?.getUser?.(userId)?.username || userId;
    const res = await fetchProfile(userId, guildId);
    const { data, avatarSrc } = await buildData(res.body, userId, guildId, false);
    storage.profiles[name] = data;

    let extra = "";
    if (getArg(args, "apply")) {
      const notes = await applyProfile(data, guildId);
      extra = "\nتم تطبيقه ✅" + (notes.length ? "\n" + notes.join("\n") : "");
    } else {
      extra = `\nطبّقه بـ /set_pr name:${name}`;
    }
    msg(ch, `أخذت بروفايل **${name}** ✅\n${savedSummary(data, avatarSrc)}${extra}`);
  };

  const debug = async (args, ctx) => {
    const ch = ctx.channel.id;
    const guildId = ctx.guild?.id;
    const userId = getArg(args, "user") || UserStore.getCurrentUser().id;
    const res = await fetchProfile(userId, guildId);
    const b = res.body ?? {};
    const j = (x) => (JSON.stringify(x ?? null) ?? "null").slice(0, 200);
    msg(
      ch,
      [
        "effect: " + j(readEffect(b, userId, guildId)),
        "decoration(server): " + j(readGuildDecoration(b)),
        "decoration(global): " + j(readGlobalDecoration(b, userId)),
        "guild_member.deco raw: " + j(b.guild_member?.avatar_decoration_data),
        "== الاعتراض ==",
        ...hookInfo,
      ].join("\n")
    );
  };

  const opt = (name, desc, type, required) => ({
    name,
    displayName: name,
    description: desc,
    displayDescription: desc,
    type,
    required,
  });

  const base = { applicationId: "-1", inputType: 1, type: 1 };
  const unregs = [];
  const cmd = (name, desc, options, execute) => {
    try {
      unregs.push(
        registerCommand({
          ...base,
          name,
          displayName: name,
          description: desc,
          displayDescription: desc,
          options,
          execute: wrapCmd(execute),
        })
      );
    } catch (e) {
      toast("فشل تسجيل الأمر " + name);
    }
  };

  cmd("save_pr", "احفظ بروفايل السيرفر الحالي", [opt("name", "اسم البروفايل", 3, true)], save);
  cmd("set_pr", "طبّق بروفايل محفوظ", [opt("name", "اسم البروفايل", 3, false)], apply);
  cmd("show_per", "اعرض بروفايلاتك كأزرار", [], show);
  cmd(
    "rename_pr",
    "غيّر اسم بروفايل محفوظ",
    [opt("name", "الاسم الحالي", 3, true), opt("new_name", "الاسم الجديد", 3, true)],
    rename
  );
  cmd("delete_pr", "احذف بروفايل محفوظ", [opt("name", "اسم البروفايل", 3, true)], del);
  cmd(
    "stole_per",
    "خذ بروفايل شخص ثاني",
    [
      opt("user", "الشخص", 6, true),
      opt("name", "اسم تحفظه به (اختياري)", 3, false),
      opt("apply", "طبّقه مباشرة", 5, false),
    ],
    stole
  );
  cmd("debug_pr", "فحص حقول البروفايل والاعتراض", [opt("user", "الشخص (اختياري)", 6, false)], debug);

  return {
    onUnload: () => {
      unregs.forEach((u) => safe(() => u()));
      patches.forEach((p) => safe(() => p()));
    },
  };
})();
