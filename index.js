(function () {
  const { registerCommand } = vendetta.commands;
  const { findByProps, findByStoreName } = vendetta.metro;
  const { storage } = vendetta.plugin;

  const RestAPI = findByProps("getAPIBaseURL", "get", "patch");
  const UserStore = findByStoreName("UserStore");
  const { sendBotMessage } = findByProps("sendBotMessage");

  storage.profiles ??= {};

  const msg = (ctx, text) => sendBotMessage(ctx.channel.id, text);

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

  const toDataURI = async (url) => {
    const blob = await (await fetch(url)).blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  };

  const save = async (args, ctx) => {
    const name = args.find((a) => a.name === "name")?.value;
    const guildId = ctx.guild?.id;
    if (!guildId) return msg(ctx, "ادخل سيرفر أول.");
    try {
      const me = UserStore.getCurrentUser();
      const res = await RestAPI.get({
        url: `/users/${me.id}/profile?with_mutual_guilds=false&guild_id=${guildId}`,
      });
      const p = res.body.guild_member_profile ?? {};
      const m = res.body.guild_member ?? {};

      const data = {
        bio: p.bio ?? "",
        pronouns: p.pronouns ?? "",
        accent_color: p.accent_color ?? null,
        theme_colors: p.theme_colors ?? null,
        profile_effect_id: p.profile_effect?.id ?? null,
        nick: m.nick ?? null,
        avatar: m.avatar
          ? await toDataURI(
              `https://cdn.discordapp.com/guilds/${guildId}/users/${me.id}/avatars/${m.avatar}.png?size=1024`
            )
          : null,
        banner: p.banner
          ? await toDataURI(
              `https://cdn.discordapp.com/guilds/${guildId}/users/${me.id}/banners/${p.banner}.png?size=1024`
            )
          : null,
      };

      storage.profiles[name] = data;
      msg(ctx, `تم حفظ البروفايل **${name}** ✅`);
    } catch (e) {
      msg(ctx, "فشل الحفظ: " + errText(e));
    }
  };

  const listText = () => {
    const names = Object.keys(storage.profiles);
    if (!names.length) return "ما عندك بروفايلات محفوظة.";
    const lines = names.map((n, i) => {
      const d = storage.profiles[n];
      const parts = [];
      if (d.avatar) parts.push("أفتار");
      if (d.banner) parts.push("بنر");
      if (d.theme_colors || d.accent_color) parts.push("ألوان");
      if (d.profile_effect_id) parts.push("افكت");
      if (d.bio) parts.push("بايو");
      if (d.nick) parts.push("نك نيم");
      return `${i + 1}. **${n}**` + (parts.length ? ` — ${parts.join("، ")}` : "");
    });
    return `بروفايلاتك المحفوظة (${names.length}):\n` + lines.join("\n");
  };

  const show = async (args, ctx) => {
    msg(ctx, listText());
  };

  const apply = async (args, ctx) => {
    const name = args.find((a) => a.name === "name")?.value;
    const guildId = ctx.guild?.id;
    if (!guildId) return msg(ctx, "ادخل سيرفر أول.");

    if (!name) return msg(ctx, listText());

    const d = storage.profiles[name];
    if (!d) return msg(ctx, `ما لقيت بروفايل اسمه ${name}`);

    const notes = [];

    // 1) النك نيم لحاله (اختياري)
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

    // 2) كل شي ثاني
    try {
      await RestAPI.patch({
        url: `/guilds/${guildId}/profile/@me`,
        body: clean({
          bio: d.bio,
          pronouns: d.pronouns,
          avatar: d.avatar,
          banner: d.banner,
          accent_color: d.accent_color,
          theme_colors: d.theme_colors,
          profile_effect_id: d.profile_effect_id,
        }),
      });
    } catch (e) {
      return msg(ctx, "فشل البروفايل: " + errText(e));
    }

    msg(
      ctx,
      `تم تطبيق **${name}** ✅` + (notes.length ? "\n" + notes.join("\n") : "")
    );
  };

  const nameOpt = (required) => ({
    name: "name",
    displayName: "name",
    description: "اسم البروفايل",
    displayDescription: "اسم البروفايل",
    type: 3,
    required,
  });

  const unregs = [
    registerCommand({
      name: "save_pr",
      displayName: "save_pr",
      description: "احفظ بروفايل السيرفر الحالي",
      displayDescription: "احفظ بروفايل السيرفر الحالي",
      options: [nameOpt(true)],
      applicationId: "-1",
      inputType: 1,
      type: 1,
      execute: save,
    }),
    registerCommand({
      name: "set_pr",
      displayName: "set_pr",
      description: "طبّق بروفايل محفوظ",
      displayDescription: "طبّق بروفايل محفوظ",
      options: [nameOpt(false)],
      applicationId: "-1",
      inputType: 1,
      type: 1,
      execute: apply,
    }),
    registerCommand({
      name: "show_pr",
      displayName: "show_pr",
      description: "اعرض البروفايلات المحفوظة",
      displayDescription: "اعرض البروفايلات المحفوظة",
      options: [],
      applicationId: "-1",
      inputType: 1,
      type: 1,
      execute: show,
    }),
  ];

  return { onUnload: () => unregs.forEach((u) => u()) };
})();
