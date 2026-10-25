(function () {
  const { registerCommand } = vendetta.commands;
  const { findByProps, findByStoreName } = vendetta.metro;
  const { instead } = vendetta.patcher;
  const { storage } = vendetta.plugin;

  const RestAPI = findByProps("getAPIBaseURL", "get", "patch");
  const UserStore = findByStoreName("UserStore");
  const SelectedChannelStore = findByStoreName("SelectedChannelStore");
  const SelectedGuildStore = findByStoreName("SelectedGuildStore");
  const { createBotMessage } = findByProps("createBotMessage");
  const MessageActions = findByProps("receiveMessage", "sendMessage");
  const Flux = findByProps("dispatch", "subscribe");
  const { sendBotMessage } = findByProps("sendBotMessage");

  storage.profiles ??= {};

  const msg = (channelId, text) => sendBotMessage(channelId, text);

  const errText = (e) => {
    try {
      const b = e?.body ?? e;
      return `${e?.status ?? ""} ${JSON.stringify(b)}`.slice(0, 500);
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

  // ===== بناء/حفظ/تطبيق =====
  const buildData = async (body, userId, guildId, withNick) => {
    const p = body.guild_member_profile ?? {};
    const m = body.guild_member ?? {};
    const u = body.user ?? {};
    const up = body.user_profile ?? {};

    let avatarUrl = null;
    let avatarSrc = "ما فيه";
    const avatarHash = u.avatar ?? UserStore.getUser(userId)?.avatar;
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
    } else if (u.banner) {
      bannerUrl = `https://cdn.discordapp.com/banners/${userId}/${u.banner}.${ext(u.banner)}?size=1024`;
    }

    const effectId =
      p.profile_effect?.id ?? up.profile_effect?.id ?? null;

    const data = {
      bio: p.bio ?? up.bio ?? "",
      pronouns: p.pronouns ?? up.pronouns ?? "",
      accent_color: p.accent_color ?? up.accent_color ?? u.accent_color ?? null,
      theme_colors: p.theme_colors ?? up.theme_colors ?? null,
      profile_effect_id: effectId,
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
    return (
      r.body.guild_member_profile?.profile_effect?.id ??
      r.body.user_profile?.profile_effect?.id ??
      null
    );
  };

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
        notes.push("الأفتار: " + errText(e));
      }
    } else {
      notes.push("الأفتار: ما انحفظ في هذا البروفايل");
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

    // فحص الافكت
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

  // ===== رسائل بأزرار =====
  const sendUI = (channelId, o) => {
    const m = createBotMessage({
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
      if (id) Flux.dispatch({ type: "MESSAGE_DELETE", channelId, id });
    } catch {}
  };

  const btn = (label, id, style) => ({
    type: 2,
    style: style ?? 1,
    label,
    custom_id: id,
  });
  const row = (components) => ({ type: 1, components });

  const toHexInt = (n) => (n == null ? 0x5865f2 : Number(n));

  const showList = (channelId) => {
    const names = Object.keys(storage.profiles);
    if (!names.length) {
      return sendUI(channelId, { content: "ما عندك بروفايلات محفوظة." });
    }
    const shown = names.slice(0, 20);
    const rows = [];
    for (let i = 0; i < shown.length; i += 5) {
      rows.push(
        row(
          shown.slice(i, i + 5).map((n) => btn(n.slice(0, 80), "pr:open:" + n, 1))
        )
      );
    }
    rows.push(row([btn("إغلاق", "pr:close", 2)]));
    return sendUI(channelId, {
      content:
        "**بروفايلاتك** — اضغط على اسم عشان تشوفه" +
        (names.length > 20 ? `\n(تظهر أول 20 من ${names.length}، والباقي بـ /set_pr)` : ""),
      components: rows,
    });
  };

  const showPreview = (channelId, name) => {
    const d = storage.profiles[name];
    if (!d) return showList(channelId);
    const accent =
      d.theme_colors?.[1] != null ? d.theme_colors[1] : d.accent_color;
    const embed = {
      type: "rich",
      title: d.nick || name,
      description:
        (d.bio ? d.bio + "\n\n" : "") +
        [
          d.pronouns ? `الضمائر: ${d.pronouns}` : null,
          d.profile_effect_id ? "✨ فيه افكت" : null,
        ]
          .filter(Boolean)
          .join(" • "),
      color: toHexInt(accent),
      footer: { text: `الاسم: ${name} — لتغيير الاسم: /rename_pr` },
    };
    if (d.bannerUrl) {
      embed.image = { url: d.bannerUrl, proxy_url: d.bannerUrl, width: 600, height: 240 };
    }
    if (d.avatarUrl) {
      embed.thumbnail = { url: d.avatarUrl, proxy_url: d.avatarUrl, width: 128, height: 128 };
    }
    return sendUI(channelId, {
      embeds: [embed],
      components: [
        row([
          btn("تطبيق", "pr:apply:" + name, 3),
          btn("حذف", "pr:del:" + name, 4),
          btn("رجوع", "pr:back", 2),
        ]),
      ],
    });
  };

  const handleClick = async (customId, messageId) => {
    const channelId = SelectedChannelStore.getChannelId();
    const guildId = SelectedGuildStore.getGuildId();
    const [, act, ...rest] = String(customId).split(":");
    const name = rest.join(":");

    removeMsg(chann
