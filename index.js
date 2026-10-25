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
    } else if (u.banner) {
      bannerUrl = `https://cdn.discordapp.com/banners/${userId}/${u.banner}.${ext(u.banner)}?size=1024`;
    }

    const decoSrc =
      u.avatar_decoration_data ??
      up.avatar_decoration_data ??
      UserStore?.getUser?.(userId)?.avatarDecorationData ??
      null;
    const decoration = decoSrc?.asset
      ? { asset: decoSrc.asset, sku_id: decoSrc.sku_id ?? decoSrc.skuId ?? null }
      : null;

    const data = {
      bio: p.bio ?? up.bio ?? "",
      pronouns: p.pronouns ?? up.pronouns ?? "",
      accent_color: p.accent_color ?? up.accent_color ?? u.accent_color ?? null,
      theme_colors: p.theme_colors ?? up.theme_colors ?? null,
      profile_effect_id: p.profile_effect?.id ?? up.profile_effect?.id ?? null,
      avatar_decoration: decoration,
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

  const savedSummary = (data, avatarSrc) =>
    `الأفتار: ${avatarSrc}\nالبنر: ${data.banner ? "انحفظ" : "ما فيه"}\nالافكت: ${data.profile_effect_id ? "انحفظ" : "ما لقيت افكت"}\nالديكوريشن: ${data.avatar_decoration ? "انحفظ" : "ما لقيت ديكوريشن"}`;

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

    // الديكوريشن (عام على الحساب كله)
    if (d.avatar_decoration?.asset) {
      const dec = d.avatar_decoration;
      const variants = [
        {
          avatar_decoration_id: dec.sku_id ?? dec.asset,
          avatar_decoration_sku_id: dec.sku_id,
        },
        { avatar_decoration_data: { asset: dec.asset, sku_id: dec.sku_id } },
      ];
      let done = false;
      let lastErr = null;
      for (const body of variants) {
        try {
          await RestAPI.patch({ url: `/users/@me`, body: clean(body) });
          const me = UserStore.getCurrentUser();
          const r = await fetchProfile(me.id, guildId);
          const now = r.body.user?.avatar_decoration_data?.asset ?? null;
          if (now === dec.asset) {
            done = true;
            break;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      if (!done) {
        notes.push(
          "الديكوريشن ما انطبق" +
            (lastErr ? ": " + errText(lastErr) : " (غالباً ما تملكه)")
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

  // ===== اعتراض ضغط الأزرار عن طريق طلب /interactions =====
  const patches = [];
  let hooked = false;
  try {
    if (patcher?.instead && RestAPI && typeof RestAPI.post === "function") {
      patches.push(
        patcher.instead("post", RestAPI, (args, orig) => {
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
              handleClick(id, b.message_id, b.channel_id);
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
      hooked = true;
    }
  } catch {}

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
    if (!guildId) ret
