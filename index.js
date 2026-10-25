(function () {
  const { registerCommand } = vendetta.commands;
  const { findByProps, findByStoreName } = vendetta.metro;
  const { React, ReactNative: RN } = vendetta.metro.common;
  const { storage } = vendetta.plugin;

  const RestAPI = findByProps("getAPIBaseURL", "get", "patch");
  const UserStore = findByStoreName("UserStore");
  const { sendBotMessage } = findByProps("sendBotMessage");
  const sheetLib = findByProps("openLazy", "hideActionSheet");
  const { View, Image, Text, ScrollView, TouchableOpacity } = RN;
  const h = React.createElement;

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
  const toHex = (n) => "#" + Number(n).toString(16).padStart(6, "0");

  const toDataURI = async (url) => {
    const blob = await (await fetch(url)).blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  };

  // يبني بيانات البروفايل من رد ديسكورد (لك أو لشخص ثاني)
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

    const data = {
      bio: p.bio ?? up.bio ?? "",
      pronouns: p.pronouns ?? up.pronouns ?? "",
      accent_color: p.accent_color ?? up.accent_color ?? u.accent_color ?? null,
      theme_colors: p.theme_colors ?? up.theme_colors ?? null,
      profile_effect_id:
        p.profile_effect?.id ?? up.profile_effect?.id ?? null,
      nick: withNick ? m.nick ?? null : null,
      avatar: avatarUrl ? await toDataURI(avatarUrl) : null,
      banner: bannerUrl ? await toDataURI(bannerUrl) : null,
    };
    return { data, avatarSrc };
  };

  const fetchProfile = (userId, guildId) =>
    RestAPI.get({
      url: `/users/${userId}/profile?with_mutual_guilds=false&guild_id=${guildId}`,
    });

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

    return notes;
  };

  const listText = () => {
    const names = Object.keys(storage.profiles);
    if (!names.length) return "ما عندك بروفايلات محفوظة.";
    return (
      `بروفايلاتك المحفوظة (${names.length}):\n` +
      names.map((n, i) => `${i + 1}. **${n}**`).join("\n")
    );
  };

  // ===== واجهة الأزرار + المعاينة =====
  function Sheet({ guildId, channelId }) {
    const [sel, setSel] = React.useState(null);
    const [busy, setBusy] = React.useState(false);

    const close = () => sheetLib?.hideActionSheet?.();

    const wrap = (children) =>
      h(
        View,
        {
          style: {
            backgroundColor: "#2b2d31",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: 16,
            paddingBottom: 28,
            maxHeight: 650,
          },
        },
        children
      );

    const btn = (key, label, onPress, bg) =>
      h(
        TouchableOpacity,
        {
          key,
          onPress,
          style: {
            backgroundColor: bg ?? "#4e5058",
            padding: 14,
            borderRadius: 10,
            marginBottom: 8,
            alignItems: "center",
          },
        },
        h(Text, { style: { color: "#fff", fontSize: 16, fontWeight: "600" } }, label)
      );

    // شاشة القائمة
    if (!sel || !storage.profiles[sel]) {
      const names = Object.keys(storage.profiles);
      return wrap([
        h(
          Text,
          { key: "t", style: { color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 12, textAlign: "center" } },
          "بروفايلاتك"
        ),
        names.length
          ? h(
              ScrollView,
              { key: "l", style: { maxHeight: 420 } },
              names.map((n) => btn("n-" + n, n, () => setSel(n), "#5865f2"))
            )
          : h(Text, { key: "e", style: { color: "#b5bac1", textAlign: "center", marginBottom: 12 } }, "ما عندك بروفايلات محفوظة."),
        btn("close", "إغلاق", close),
      ]);
    }

    // شاشة المعاينة
    const d = storage.profiles[sel];
    const primary = d.theme_colors?.[0] != null ? toHex(d.theme_colors[0]) : "#1e1f22";
    const accent =
      d.theme_colors?.[1] != null
        ? toHex(d.theme_colors[1])
        : d.accent_color != null
        ? toHex(d.accent_color)
        : "#5865f2";

    const card = h(
      View,
      {
        key: "card",
        style: { backgroundColor: primary, borderRadius: 14, overflow: "hidden", marginBottom: 12, borderWidth: 2, borderColor: accent },
      },
      [
        d.banner
          ? h(Image, { key: "b", source: { uri: d.banner }, style: { width: "100%", height: 100 }, resizeMode: "cover" })
          : h(View, { key: "b", style: { width: "100%", height: 100, backgroundColor: accent } }),
        h(
          View,
          { key: "body", style: { padding: 12 } },
          [
            d.avatar
              ? h(Image, {
                  key: "a",
                  source: { uri: d.avatar },
                  style: { width: 80, height: 80, borderRadius: 40, marginTop: -52, borderWidth: 5, borderColor: primary, backgroundColor: primary },
                })
              : h(View, { key: "a", style: { width: 80, height: 80, borderRadius: 40, marginTop: -52, borderWidth: 5, borderColor: primary, backgroundColor: "#4e5058" } }),
            h(Text, { key: "n", style: { color: "#fff", fontSize: 20, fontWeight: "700", marginTop: 6 } }, d.nick || sel),
            d.pronouns ? h(Text, { key: "p", style: { color: "#dbdee1", fontSize: 13 } }, d.pronouns) : null,
            d.bio ? h(Text, { key: "bio", style: { color: "#dbdee1", marginTop: 8 } }, d.bio) : null,
            h(
              View,
              { key: "c", style: { flexDirection: "row", marginTop: 10 } },
              [
                h(View, { key: "c1", style: { width: 22, height: 22, borderRadius: 11, backgroundColor: primary, borderWidth: 1, borderColor: "#fff", marginRight: 6 } }),
                h(View, { key: "c2", style: { width: 22, height: 22, borderRadius: 11, backgroundColor: accent, borderWidth: 1, borderColor: "#fff" } }),
                d.profile_effect_id
                  ? h(Text, { key: "fx", style: { color: "#dbdee1", marginLeft: 10 } }, "✨ فيه افكت")
                  : null,
              ]
            ),
          ]
        ),
      ]
    );

    return wrap([
      card,
      btn(
        "apply",
        busy ? "جاري التطبيق..." : "تطبيق",
        async () => {
          if (busy) return;
          if (!guildId) {
            close();
            return msg(channelId, "ادخل سيرفر أول.");
          }
          setBusy(true);
          const notes = await applyProfile(d, guildId);
          setBusy(false);
          close();
          msg(channelId, `تم تطبيق **${sel}** ✅` + (notes.length ? "\n" + notes.join("\n") : ""));
        },
        "#248046"
      ),
      btn("del", "حذف", () => {
        delete storage.profiles[sel];
        setSel(null);
      }, "#da373c"),
      btn("back", "رجوع", () => setSel(null)),
    ]);
  }

  // ===== الأوامر =====
  const getArg = (args, n) => args.find((a) => a.name === n)?.value;

  const save = async (args, ctx) => {
    const name = getArg(args, "name");
    const guildId = ctx.guild?.id;
    const ch = ctx.channel.id;
    if (!guildId) return msg(ch, "ادخل سيرفر أول.");
    try {
      const me = UserStore.getCurrentUser();
      const res = await fetchProfile(me.id, guildId);
      const { data, avatarSrc } = await buildData(res.body, me.id, guildId, true);
      storage.profiles[name] = data;
      msg(ch, `تم حفظ البروفايل **${name}** ✅\nالأفتار: ${avatarSrc}\nالبنر: ${data.banner ? "انحفظ" : "ما فيه"}`);
    } catch (e) {
      msg(ch, "فشل الحفظ: " + errText(e));
    }
  };

  const apply = async (args, ctx) => {
    const name = getArg(args, "name");
    const guildId = ctx.guild?.id;
    const ch = ctx.channel.id;
    if (!guildId) return msg(ch, "ادخل سيرفر أول.");
    if (!name) return msg(ch, listText());
    const d = storage.profiles[name];
    if (!d) return msg(ch, `ما لقيت بروفايل اسمه ${name}`);
    const notes = await applyProfile(d, guildId);
    msg(ch, `تم تطبيق **${name}** ✅` + (notes.length ? "\n" + notes.join("\n") : ""));
  };

  const show = async (args, ctx) => {
    const ch = ctx.channel.id;
    const guildId = ctx.guild?.id;
    try {
      if (!sheetLib?.openLazy) throw new Error("no sheet");
      sheetLib.openLazy(
        Promise.resolve({
          default: () => h(Sheet, { guildId, channelId: ch }),
        }),
        "per-profiles",
        {}
      );
    } catch (e) {
      msg(ch, listText());
    }
  };

  const stole = async (args, ctx) => {
    const userId = getArg(args, "user");
    const guildId = ctx.guild?.id;
    const ch = ctx.channel.id;
    if (!guildId) return msg(ch, "ادخل سيرفر أول.");
    if (!userId) return msg(ch, "حدد الشخص.");
    const name =
      getArg(args, "name") || UserStore.getUser(userId)?.username || userId;
    try {
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
      msg(ch, `أخذت بروفايل **${name}** ✅\nالأفتار: ${avatarSrc}\nالبنر: ${data.banner ? "انحفظ" : "ما فيه"}${extra}`);
    } catch (e) {
      msg(ch, "فشل الأخذ: " + errText(e));
    }
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

  const unregs = [
    registerCommand({
      ...base,
      name: "save_pr",
      displayName: "save_pr",
      description: "احفظ بروفايل السيرفر الحالي",
      displayDescription: "احفظ بروفايل السيرفر الحالي",
      options: [opt("name", "اسم البروفايل", 3, true)],
      execute: save,
    }),
    registerCommand({
      ...base,
      name: "set_pr",
      displayName: "set_pr",
      description: "طبّق بروفايل محفوظ",
      displayDescription: "طبّق بروفايل محفوظ",
      options: [opt("name", "اسم البروفايل", 3, false)],
      execute: apply,
    }),
    registerCommand({
      ...base,
      name: "show_per",
      displayName: "show_per",
      description: "اعرض بروفايلاتك كأزرار مع معاينة",
      displayDescription: "اعرض بروفايلاتك كأزرار مع معاينة",
      options: [],
      execute: show,
    }),
    registerCommand({
      ...base,
      name: "stole_per",
      displayName: "stole_per",
      description: "خذ بروفايل شخص ثاني",
      displayDescription: "خذ بروفايل شخص ثاني",
      options: [
        opt("user", "الشخص", 6, true),
        opt("name", "اسم تحفظه به (اختياري)", 3, false),
        opt("apply", "طبّقه مباشرة", 5, false),
      ],
      execute: stole,
    }),
  ];

  return { onUnload: () => unregs.forEach((u) => u()) };
})();
