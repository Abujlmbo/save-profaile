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
  const { React, ReactNative: RN } = vendetta.metro.common;
  const { storage } = vendetta.plugin;

  const RestAPI = safe(() => findByProps("getAPIBaseURL", "get", "patch"));
  const UserStore = safe(() => findByStoreName("UserStore"));
  const UserProfileStore = safe(() => findByStoreName("UserProfileStore"));
  const SelectedGuildStore = safe(() => findByStoreName("SelectedGuildStore"));
  const BotMsg = safe(() => findByProps("sendBotMessage"));
  const sheetLib = safe(() => findByProps("openLazy", "hideActionSheet"));
  const AlertModule = safe(() => findByProps("openAlert", "dismissAlert"));
  const AlertLib = safe(() => findByProps("AlertModal", "AlertActions"));
  const patcher = safe(() => vendetta.patcher);

  const { View, Image, Text, ScrollView, TouchableOpacity, Dimensions } = RN;
  const h = React.createElement;

  storage.profiles ??= {};

  const SHEET_KEY = "per-profiles";
  const ALERT_KEY = "vendetta-custom-alert";
  const OWN_KEY = "per-profiles-alert";

  // لو true: ستايل الاسم يتطبق على حسابك كله كمحاولة أخيرة (مو بس السيرفر)
  const ALLOW_GLOBAL_NAME_STYLE = false;

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

  // ===== إغلاق النافذة =====
  const closeSheet = () => {
    const keys = [OWN_KEY, ALERT_KEY, "vendetta-alert", "custom-alert"];
    for (const k of keys) safe(() => AlertModule?.dismissAlert?.(k));
    const tries = [
      () => AlertModule?.dismissAlert?.(),
      () => sheetLib?.hideActionSheet?.(SHEET_KEY),
      () => sheetLib?.hideActionSheet?.(),
      () => findByProps("closeLazy")?.closeLazy?.(SHEET_KEY),
    ];
    for (const t of tries) safe(t);
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

  const decoUrl = (asset) =>
    `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=160&passthrough=true`;

  // ===== ستايل الاسم (الخط + اللون + التأثير) =====
  const readNameStyle = (body) => {
    const pick = (s) => {
      if (!s || typeof s !== "object") return null;
      const has =
        s.font_id != null ||
        s.effect_id != null ||
        (Array.isArray(s.colors) && s.colors.length > 0);
      return has ? s : null;
    };
    return pick(body.guild_member?.display_name_styles) ?? pick(body.user?.display_name_styles) ?? null;
  };

  const sameStyle = (a, b) => {
    const norm = (s) =>
      JSON.stringify([s?.font_id ?? null, s?.effect_id ?? null, s?.colors ?? []]);
    return norm(a) === norm(b);
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
      display_name_styles: readNameStyle(body),
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
    `الأفتار: ${avatarSrc}\nالبنر: ${data.banner ? "انحفظ" : "ما فيه"}\nالافكت: ${data.profile_effect_id ? "انحفظ" : "ما لقيت افكت"}\nالديكوريشن: ${data.avatar_decoration ? "انحفظ" : "ما لقيت ديكوريشن للسيرفر"}\nستايل الاسم: ${data.display_name_styles ? "انحفظ" : "ما لقيت ستايل"}`;

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
    }

    // الديكوريشن (خاص بالسيرفر)
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
            (lastErr ? ": " + errText(lastErr) : " (غالباً ما تملكه)")
        );
      }
    }

    // البنر والألوان والبايو والافكت
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

    // فحص الافكت + إعادة محاولة منفصلة
    if (d.profile_effect_id) {
      try {
        let got = await currentEffect(guildId);
        if (String(got) !== String(d.profile_effect_id)) {
          try {
            await RestAPI.patch({
              url: `/guilds/${guildId}/profile/@me`,
              body: { profile_effect_id: String(d.profile_effect_id) },
            });
          } catch (e) {
            notes.push("الافكت (إعادة): " + errText(e));
          }
          got = await currentEffect(guildId);
        }
        if (String(got) !== String(d.profile_effect_id)) {
          notes.push(
            `الافكت ما انطبق: ديسكورد تجاهله وخلّى الحالي (${d.profile_effect_id}). غالباً الصيغة مختلفة، استخدم /spy_pr.`
          );
        }
      } catch (e) {
        notes.push("فحص الافكت فشل: " + errText(e));
      }
    }

    // ستايل الاسم
    if (d.display_name_styles) {
      const st = d.display_name_styles;
      const attempts = [
        { url: `/guilds/${guildId}/members/@me`, body: { display_name_styles: st } },
        { url: `/guilds/${guildId}/profile/@me`, body: { display_name_styles: st } },
      ];
      if (ALLOW_GLOBAL_NAME_STYLE) {
        attempts.push({ url: `/users/@me/profile`, body: { display_name_styles: st } });
      }
      let done = false;
      let lastErr = null;
      for (const a of attempts) {
        try {
          await RestAPI.patch({ url: a.url, body: a.body });
          const me = UserStore.getCurrentUser();
          const r = await fetchProfile(me.id, guildId);
          if (sameStyle(readNameStyle(r.body), st)) {
            done = true;
            break;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      if (!done) {
        notes.push(
          "ستايل الاسم ما انطبق" +
            (lastErr ? ": " + errText(lastErr) : " (ديسكورد تجاهله، الـ endpoint أو الحقل مختلف، استخدم /spy_pr)")
        );
      }
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

  // ===== واجهة البطاقة =====
  const C = {
    bg: "#1e1f22",
    sheet: "#2b2d31",
    box: "#232428",
    line: "#3f4147",
    text: "#f2f3f5",
    sub: "#b5bac1",
    blurple: "#5865f2",
    green: "#248046",
    red: "#da373c",
    gray: "#4e5058",
  };

  function ProfileCard({ d, name, W }) {
    const bannerH = Math.round(W / 2.5);
    const AV = 84;
    const accent =
      d.theme_colors?.[1] != null
        ? toHex(d.theme_colors[1])
        : d.accent_color != null
        ? toHex(d.accent_color)
        : C.blurple;
    const bannerSrc = d.bannerUrl || d.banner;
    const avatarSrc = d.avatarUrl || d.avatar;

    const ns = d.display_name_styles;
    const nameColors = Array.isArray(ns?.colors) ? ns.colors : [];
    const nameColor = nameColors[0] != null ? toHex(nameColors[0]) : C.text;

    const colors = [];
    (d.theme_colors ?? []).forEach((c) => colors.push(c));
    if (d.accent_color != null && !colors.includes(d.accent_color)) colors.push(d.accent_color);

    const label = (t) =>
      h(Text, { style: { color: C.sub, fontSize: 10, fontWeight: "700", marginBottom: 8, textAlign: "center" } }, t);

    const box = (key, title, children) =>
      h(
        View,
        {
          key,
          style: {
            flex: 1,
            backgroundColor: C.box,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.line,
            padding: 6,
            marginHorizontal: 2,
            minHeight: 86,
            alignItems: "center",
          },
        },
        [label(title), children]
      );

    const dots = (arr, size) =>
      h(
        View,
        { style: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" } },
        arr.slice(0, 6).map((c, i) =>
          h(View, {
            key: "dot" + i,
            style: { width: size, height: size, borderRadius: size / 2, backgroundColor: toHex(c), margin: 2, borderWidth: 1, borderColor: "#ffffff55" },
          })
        )
      );

    return h(
      View,
      {
        style: {
          width: W,
          backgroundColor: C.bg,
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: C.line,
        },
      },
      [
        bannerSrc
          ? h(Image, { key: "b", source: { uri: bannerSrc }, style: { width: W, height: bannerH }, resizeMode: "cover" })
          : h(View, { key: "b", style: { width: W, height: bannerH, backgroundColor: accent } }),

        h(
          View,
          { key: "av", style: { paddingHorizontal: 16 } },
          h(
            View,
            { style: { width: AV, height: AV, marginTop: -AV / 2, alignItems: "center", justifyContent: "center" } },
            [
              h(
                View,
                {
                  key: "ring",
                  style: {
                    width: AV,
                    height: AV,
                    borderRadius: AV / 2,
                    borderWidth: 5,
                    borderColor: C.bg,
                    backgroundColor: C.gray,
                    overflow: "hidden",
                  },
                },
                avatarSrc
                  ? h(Image, { source: { uri: avatarSrc }, style: { width: "100%", height: "100%" } })
                  : null
              ),
              d.avatar_decoration?.asset
                ? h(Image, {
                    key: "deco",
                    source: { uri: decoUrl(d.avatar_decoration.asset) },
                    style: { position: "absolute", width: AV * 1.2, height: AV * 1.2 },
                  })
                : null,
            ]
          )
        ),

        h(
          View,
          { key: "info", style: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 } },
          [
            h(Text, { key: "n", style: { color: nameColor, fontSize: 21, fontWeight: "800" } }, d.nick || name),
            d.pronouns ? h(Text, { key: "p", style: { color: C.sub, fontSize: 13, marginTop: 2 } }, d.pronouns) : null,
            d.bio ? h(Text, { key: "bio", style: { color: C.text, fontSize: 14, marginTop: 8 } }, d.bio) : null,
          ]
        ),

        h(
          View,
          { key: "boxes", style: { flexDirection: "row", padding: 8, paddingTop: 8 } },
          [
            box("c", "الألوان", colors.length ? dots(colors, 20) : h(Text, { style: { color: C.sub } }, "—")),
            box(
              "e",
              "الافكت",
              d.profile_effect_id
                ? h(
                    View,
                    { style: { width: 40, height: 40, borderRadius: 12, backgroundColor: accent + "55", borderWidth: 1, borderColor: accent, alignItems: "center", justifyContent: "center" } },
                    h(Text, { style: { fontSize: 20 } }, "✨")
                  )
                : h(Text, { style: { color: C.sub } }, "—")
            ),
            box(
              "d",
              "الديكوريشن",
              d.avatar_decoration?.asset
                ? h(Image, { source: { uri: decoUrl(d.avatar_decoration.asset) }, style: { width: 44, height: 44 } })
                : h(Text, { style: { color: C.sub } }, "—")
            ),
            box(
              "s",
              "ستايل الاسم",
              ns
                ? h(View, { style: { alignItems: "center" } }, [
                    nameColors.length ? dots(nameColors, 16) : null,
                    ns.font_id != null
                      ? h(Text, { key: "f", style: { color: C.sub, fontSize: 10, marginTop: 2 } }, "خط " + ns.font_id)
                      : null,
                    ns.effect_id != null
                      ? h(Text, { key: "ef", style: { color: C.sub, fontSize: 10 } }, "تأثير " + ns.effect_id)
                      : null,
                  ])
                : h(Text, { style: { color: C.sub } }, "—")
            ),
          ]
        ),
      ]
    );
  }

  function Sheet({ guildId, channelId, mode }) {
    const W = Dimensions.get("window").width - (mode === "alert" ? 88 : 32);
    const [sel, setSel] = React.useState(Object.keys(storage.profiles)[0] ?? null);
    const [busy, setBusy] = React.useState(false);
    const [confirmDel, setConfirmDel] = React.useState(false);
    const [, bump] = React.useState(0);
    const [closed, setClosed] = React.useState(false);

    const names = Object.keys(storage.profiles);
    const current = sel && storage.profiles[sel] ? sel : names[0] ?? null;
    const d = current ? storage.profiles[current] : null;

    const close = () => {
      closeSheet();
      if (mode !== "alert") setClosed(true);
    };

    const button = (key, text, onPress, bg) =>
      h(
        TouchableOpacity,
        {
          key,
          onPress,
          style: { flex: 1, backgroundColor: bg, paddingVertical: 14, borderRadius: 12, alignItems: "center", marginHorizontal: 4 },
        },
        h(Text, { style: { color: "#fff", fontSize: 15, fontWeight: "700" } }, text)
      );

    if (closed) return h(View, { style: { height: 1 } });

    return h(
      View,
      {
        style: {
          backgroundColor: C.sheet,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          borderBottomLeftRadius: 20,
          borderBottomRightRadius: 20,
          paddingTop: 14,
          paddingBottom: 26,
          paddingHorizontal: 16,
          maxHeight: Dimensions.get("window").height * 0.88,
        },
      },
      !names.length
        ? [
            h(Text, { key: "e", style: { color: C.text, textAlign: "center", fontSize: 16, marginVertical: 24 } }, "ما عندك بروفايلات محفوظة.\nاحفظ واحد بـ /save_pr"),
            h(View, { key: "r", style: { flexDirection: "row" } }, button("c", "إغلاق", close, C.gray)),
          ]
        : [
            h(
              ScrollView,
              { key: "chips", horizontal: true, showsHorizontalScrollIndicator: false, style: { flexGrow: 0, marginBottom: 12 } },
              names.map((n) =>
                h(
                  TouchableOpacity,
                  {
                    key: "chip-" + n,
                    onPress: () => {
                      setSel(n);
                      setConfirmDel(false);
                    },
                    style: {
                      backgroundColor: n === current ? C.blurple : C.box,
                      paddingVertical: 9,
                      paddingHorizontal: 16,
                      borderRadius: 20,
                      marginRight: 8,
                      borderWidth: 1,
                      borderColor: n === current ? C.blurple : C.line,
                    },
                  },
                  h(Text, { style: { color: "#fff", fontWeight: "700" } }, n)
                )
              )
            ),
            h(
              ScrollView,
              { key: "card", style: { flexGrow: 0 }, showsVerticalScrollIndicator: false },
              h(ProfileCard, { d, name: current, W })
            ),
            h(
              View,
              { key: "btns", style: { flexDirection: "row", marginTop: 14 } },
              [
                button(
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
                    msg(channelId, `تم تطبيق **${current}** ✅` + (notes.length ? "\n" + notes.join("\n") : ""));
                  },
                  C.green
                ),
                button(
                  "del",
                  confirmDel ? "تأكيد الحذف" : "حذف",
                  () => {
                    if (!confirmDel) return setConfirmDel(true);
                    delete storage.profiles[current];
                    setConfirmDel(false);
                    setSel(Object.keys(storage.profiles)[0] ?? null);
                    bump((x) => x + 1);
                  },
                  C.red
                ),
                button("close", "إغلاق", close, C.gray),
              ]
            ),
          ]
    );
  }

  // ===== الأوامر =====
  const getArg = (args, n) => args.find((a) => a.name === n)?.value;

  const wrapCmd = (fn) => async (args, ctx) => {
    try {
      await fn(args, ctx);
    } catch (e) {
      msg(ctx?.channel?.id, "خطأ: " + errText(e));
    }
  };

  const openSheet = (ctx) => {
    const ch = ctx.channel.id;
    const guildId = ctx.guild?.id ?? SelectedGuildStore?.getGuildId?.();
    const alerts = safe(() => vendetta.ui.alerts);

    try {
      if (AlertModule?.openAlert && AlertLib?.AlertModal) {
        const { AlertModal, AlertActions, AlertActionButton } = AlertLib;
        AlertModule.openAlert(
          OWN_KEY,
          h(AlertModal, {
            title: "بروفايلاتك",
            extraContent: h(Sheet, { guildId, channelId: ch, mode: "alert" }),
            actions:
              AlertActions && AlertActionButton
                ? h(
                    AlertActions,
                    null,
                    h(AlertActionButton, { text: "إغلاق", variant: "secondary", onPress: closeSheet })
                  )
                : undefined,
          })
        );
        return;
      }
    } catch (e) {}

    try {
      if (alerts?.showCustomAlert) {
        alerts.showCustomAlert(Sheet, { guildId, channelId: ch, mode: "alert" });
        return;
      }
    } catch (e) {}

    try {
      if (!sheetLib?.openLazy) throw new Error("no sheet");
      sheetLib.openLazy(
        Promise.resolve({ default: () => h(Sheet, { guildId, channelId: ch, mode: "sheet" }) }),
        SHEET_KEY,
        {}
      );
    } catch (e) {
      msg(ch, listText());
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
    if (!name) return openSheet(ctx);
    const d = storage.profiles[name];
    if (!d) return msg(ch, `ما لقيت بروفايل اسمه ${name}`);
    const notes = await applyProfile(d, guildId);
    msg(ch, `تم تطبيق **${name}** ✅` + (notes.length ? "\n" + notes.join("\n") : ""));
  };

  const show = async (args, ctx) => openSheet(ctx);

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
      extra = `\nشوفه من /show_per أو طبّقه بـ /set_pr name:${name}`;
    }
    msg(ch, `أخذت بروفايل **${name}** ✅\n${savedSummary(data, avatarSrc)}${extra}`);
  };

  const debug = async (args, ctx) => {
    const ch = ctx.channel.id;
    const guildId = ctx.guild?.id;
    const userId = getArg(args, "user") || UserStore.getCurrentUser().id;
    const res = await fetchProfile(userId, guildId);
    const b = res.body ?? {};
    const j = (x) => (JSON.stringify(x ?? null) ?? "null").slice(0, 250);
    msg(
      ch,
      [
        "effect: " + j(readEffect(b, userId, guildId)),
        "decoration(server): " + j(readGuildDecoration(b)),
        "decoration(global): " + j(readGlobalDecoration(b, userId)),
        "nameStyle(member): " + j(b.guild_member?.display_name_styles),
        "nameStyle(user): " + j(b.user?.display_name_styles),
        "nameStyle(result): " + j(readNameStyle(b)),
        "sheet: " + !!sheetLib?.openLazy,
        "alertLib: " + !!AlertLib?.AlertModal,
        "openAlert: " + typeof AlertModule?.openAlert,
        "patcher.after: " + typeof patcher?.after,
      ].join("\n")
    );
  };

  // ===== تجسس على طلبات ديسكورد (للتشخيص) =====
  let spyOn = false;
  const spyLog = [];
  const spyPatches = [];

  const shorten = (_k, v) =>
    typeof v === "string" && v.length > 80 ? v.slice(0, 40) + "…(" + v.length + ")" : v;

  ["patch", "put", "post"].forEach((fn) => {
    if (!patcher?.after || typeof RestAPI?.[fn] !== "function") return;
    spyPatches.push(
      patcher.after(fn, RestAPI, (args) => {
        if (!spyOn) return;
        try {
          const a = args[0] ?? {};
          const url = String(a.url ?? "");
          if (url.includes("/interactions")) return;
          let body = "";
          try {
            body = JSON.stringify(a.body ?? null, shorten);
          } catch {}
          spyLog.push(`${fn.toUpperCase()} ${url}\n${body}`);
        } catch {}
      })
    );
  });

  const spy = async (args, ctx) => {
    const ch = ctx.channel.id;
    if (!spyOn) {
      spyOn = true;
      spyLog.length = 0;
      return msg(
        ch,
        "بدأ التجسس ✅\nالحين غيّر الافكت وستايل الاسم يدوياً من إعدادات بروفايل السيرفر في ديسكورد واحفظ، وبعدها شغّل /spy_pr مرة ثانية."
      );
    }
    spyOn = false;
    if (!spyLog.length) {
      return msg(ch, "ما التقطت أي طلب. (patcher.after: " + typeof patcher?.after + ")");
    }
    msg(ch, spyLog.slice(-8).join("\n\n").slice(0, 1800));
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
  cmd("show_per", "اعرض بروفايلاتك كبطاقات", [], show);
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
  cmd("debug_pr", "فحص حقول البروفايل", [opt("user", "الشخص (اختياري)", 6, false)], debug);
  cmd("spy_pr", "تشخيص: التقط طلبات ديسكورد", [], spy);

  return {
    onUnload: () => {
      unregs.forEach((u) => safe(() => u()));
      spyPatches.forEach((p) => safe(() => p()));
      safe(() => closeSheet());
    },
  };
})();
