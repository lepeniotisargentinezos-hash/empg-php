const de = (e, t) => e === t,
    V = Symbol("solid-proxy"),
    te = typeof Proxy == "function",
    he = Symbol("solid-track"),
    F = {
        equals: de
    };
let ne = re;
const x = 1,
    U = 2,
    se = {
        owned: null,
        cleanups: null,
        context: null,
        owner: null
    };
var h = null;
let v = null,
    ge = null,
    g = null,
    b = null,
    P = null,
    K = 0;

function R(e, t) {
    const n = g,
        s = h,
        l = e.length === 0,
        r = t === void 0 ? s : t,
        o = l ? se : {
            owned: null,
            cleanups: null,
            context: r ? r.context : null,
            owner: r
        },
        i = l ? e : () => e(() => m(() => N(o)));
    h = o, g = null;
    try {
        return k(i, !0)
    } finally {
        g = n, h = s
    }
}

function ye(e, t) {
    t = t ? Object.assign({}, F, t) : F;
    const n = {
            value: e,
            observers: null,
            observerSlots: null,
            comparator: t.equals || void 0
        },
        s = l => (typeof l == "function" && (l = l(n.value)), oe(n, l));
    return [le.bind(n), s]
}

function $(e, t, n) {
    const s = Y(e, t, !1, x);
    L(s)
}

function be(e, t, n) {
    ne = pe;
    const s = Y(e, t, !1, x);
    s.user = !0, P ? P.push(s) : L(s)
}

function w(e, t, n) {
    n = n ? Object.assign({}, F, n) : F;
    const s = Y(e, t, !0, 0);
    return s.observers = null, s.observerSlots = null, s.comparator = n.equals || void 0, L(s), le.bind(s)
}

function Xe(e) {
    return k(e, !1)
}

function m(e) {
    if (g === null) return e();
    const t = g;
    g = null;
    try {
        return e()
    } finally {
        g = t
    }
}

function We(e) {
    be(() => m(e))
}

function we(e) {
    return h === null || (h.cleanups === null ? h.cleanups = [e] : h.cleanups.push(e)), e
}

function Ye() {
    return g
}

function Qe(e, t) {
    const n = Symbol("context");
    return {
        id: n,
        Provider: Ee(n),
        defaultValue: e
    }
}

function ze(e) {
    let t;
    return h && h.context && (t = h.context[e.id]) !== void 0 ? t : e.defaultValue
}

function ie(e) {
    const t = w(e),
        n = w(() => G(t()));
    return n.toArray = () => {
        const s = n();
        return Array.isArray(s) ? s : s != null ? [s] : []
    }, n
}

function le() {
    if (this.sources && this.state)
        if (this.state === x) L(this);
        else {
            const e = b;
            b = null, k(() => B(this), !1), b = e
        }
    if (g) {
        const e = this.observers ? this.observers.length : 0;
        g.sources ? (g.sources.push(this), g.sourceSlots.push(e)) : (g.sources = [this], g.sourceSlots = [e]), this.observers ? (this.observers.push(g), this.observerSlots.push(g.sources.length - 1)) : (this.observers = [g], this.observerSlots = [g.sources.length - 1])
    }
    return this.value
}

function oe(e, t, n) {
    let s = e.value;
    return (!e.comparator || !e.comparator(s, t)) && (e.value = t, e.observers && e.observers.length && k(() => {
        for (let l = 0; l < e.observers.length; l += 1) {
            const r = e.observers[l],
                o = v && v.running;
            o && v.disposed.has(r), (o ? !r.tState : !r.state) && (r.pure ? b.push(r) : P.push(r), r.observers && ce(r)), o || (r.state = x)
        }
        if (b.length > 1e6) throw b = [], new Error
    }, !1)), t
}

function L(e) {
    if (!e.fn) return;
    N(e);
    const t = K;
    me(e, e.value, t)
}

function me(e, t, n) {
    let s;
    const l = h,
        r = g;
    g = h = e;
    try {
        s = e.fn(t)
    } catch (o) {
        return e.pure && (e.state = x, e.owned && e.owned.forEach(N), e.owned = null), e.updatedAt = n + 1, fe(o)
    } finally {
        g = r, h = l
    }(!e.updatedAt || e.updatedAt <= n) && (e.updatedAt != null && "observers" in e ? oe(e, s) : e.value = s, e.updatedAt = n)
}

function Y(e, t, n, s = x, l) {
    const r = {
        fn: e,
        state: s,
        updatedAt: null,
        owned: null,
        sources: null,
        sourceSlots: null,
        cleanups: null,
        value: t,
        owner: h,
        context: h ? h.context : null,
        pure: n
    };
    return h === null || h !== se && (h.owned ? h.owned.push(r) : h.owned = [r]), r
}

function _(e) {
    if (e.state === 0) return;
    if (e.state === U) return B(e);
    if (e.suspense && m(e.suspense.inFallback)) return e.suspense.effects.push(e);
    const t = [e];
    for (;
        (e = e.owner) && (!e.updatedAt || e.updatedAt < K);) e.state && t.push(e);
    for (let n = t.length - 1; n >= 0; n--)
        if (e = t[n], e.state === x) L(e);
        else if (e.state === U) {
        const s = b;
        b = null, k(() => B(e, t[0]), !1), b = s
    }
}

function k(e, t) {
    if (b) return e();
    let n = !1;
    t || (b = []), P ? n = !0 : P = [], K++;
    try {
        const s = e();
        return Ae(n), s
    } catch (s) {
        n || (P = null), b = null, fe(s)
    }
}

function Ae(e) {
    if (b && (re(b), b = null), e) return;
    const t = P;
    P = null, t.length && k(() => ne(t), !1)
}

function re(e) {
    for (let t = 0; t < e.length; t++) _(e[t])
}

function pe(e) {
    let t, n = 0;
    for (t = 0; t < e.length; t++) {
        const s = e[t];
        s.user ? e[n++] = s : _(s)
    }
    for (t = 0; t < n; t++) _(e[t])
}

function B(e, t) {
    e.state = 0;
    for (let n = 0; n < e.sources.length; n += 1) {
        const s = e.sources[n];
        if (s.sources) {
            const l = s.state;
            l === x ? s !== t && (!s.updatedAt || s.updatedAt < K) && _(s) : l === U && B(s, t)
        }
    }
}

function ce(e) {
    for (let t = 0; t < e.observers.length; t += 1) {
        const n = e.observers[t];
        n.state || (n.state = U, n.pure ? b.push(n) : P.push(n), n.observers && ce(n))
    }
}

function N(e) {
    let t;
    if (e.sources)
        for (; e.sources.length;) {
            const n = e.sources.pop(),
                s = e.sourceSlots.pop(),
                l = n.observers;
            if (l && l.length) {
                const r = l.pop(),
                    o = n.observerSlots.pop();
                s < l.length && (r.sourceSlots[o] = s, l[s] = r, n.observerSlots[s] = o)
            }
        }
    if (e.tOwned) {
        for (t = e.tOwned.length - 1; t >= 0; t--) N(e.tOwned[t]);
        delete e.tOwned
    }
    if (e.owned) {
        for (t = e.owned.length - 1; t >= 0; t--) N(e.owned[t]);
        e.owned = null
    }
    if (e.cleanups) {
        for (t = e.cleanups.length - 1; t >= 0; t--) e.cleanups[t]();
        e.cleanups = null
    }
    e.state = 0
}

function Se(e) {
    return e instanceof Error ? e : new Error(typeof e == "string" ? e : "Unknown error", {
        cause: e
    })
}

function fe(e, t = h) {
    throw Se(e)
}

function G(e) {
    if (typeof e == "function" && !e.length) return G(e());
    if (Array.isArray(e)) {
        const t = [];
        for (let n = 0; n < e.length; n++) {
            const s = G(e[n]);
            Array.isArray(s) ? t.push.apply(t, s) : t.push(s)
        }
        return t
    }
    return e
}

function Ee(e, t) {
    return function(s) {
        let l;
        return $(() => l = m(() => (h.context = { ...h.context,
            [e]: s.value
        }, ie(() => s.children))), void 0), l
    }
}
const Pe = Symbol("fallback");

function Q(e) {
    for (let t = 0; t < e.length; t++) e[t]()
}

function xe(e, t, n = {}) {
    let s = [],
        l = [],
        r = [],
        o = 0,
        i = t.length > 1 ? [] : null;
    return we(() => Q(r)), () => {
        let c = e() || [],
            a = c.length,
            u, f;
        return c[he], m(() => {
            let y, S, O, M, D, A, p, E, T;
            if (a === 0) o !== 0 && (Q(r), r = [], s = [], l = [], o = 0, i && (i = [])), n.fallback && (s = [Pe], l[0] = R(ae => (r[0] = ae, n.fallback())), o = 1);
            else if (o === 0) {
                for (l = new Array(a), f = 0; f < a; f++) s[f] = c[f], l[f] = R(d);
                o = a
            } else {
                for (O = new Array(a), M = new Array(a), i && (D = new Array(a)), A = 0, p = Math.min(o, a); A < p && s[A] === c[A]; A++);
                for (p = o - 1, E = a - 1; p >= A && E >= A && s[p] === c[E]; p--, E--) O[E] = l[p], M[E] = r[p], i && (D[E] = i[p]);
                for (y = new Map, S = new Array(E + 1), f = E; f >= A; f--) T = c[f], u = y.get(T), S[f] = u === void 0 ? -1 : u, y.set(T, f);
                for (u = A; u <= p; u++) T = s[u], f = y.get(T), f !== void 0 && f !== -1 ? (O[f] = l[u], M[f] = r[u], i && (D[f] = i[u]), f = S[f], y.set(T, f)) : r[u]();
                for (f = A; f < a; f++) f in O ? (l[f] = O[f], r[f] = M[f], i && (i[f] = D[f], i[f](f))) : l[f] = R(d);
                l = l.slice(0, o = a), s = c.slice(0)
            }
            return l
        });

        function d(y) {
            if (r[f] = y, i) {
                const [S, O] = ye(f);
                return i[f] = O, t(c[f], S)
            }
            return t(c[f])
        }
    }
}

function Je(e, t) {
    return m(() => e(t || {}))
}

function j() {
    return !0
}
const H = {
    get(e, t, n) {
        return t === V ? n : e.get(t)
    },
    has(e, t) {
        return t === V ? !0 : e.has(t)
    },
    set: j,
    deleteProperty: j,
    getOwnPropertyDescriptor(e, t) {
        return {
            configurable: !0,
            enumerable: !0,
            get() {
                return e.get(t)
            },
            set: j,
            deleteProperty: j
        }
    },
    ownKeys(e) {
        return e.keys()
    }
};

function q(e) {
    return (e = typeof e == "function" ? e() : e) ? e : {}
}

function Oe() {
    for (let e = 0, t = this.length; e < t; ++e) {
        const n = this[e]();
        if (n !== void 0) return n
    }
}

function Ze(...e) {
    let t = !1;
    for (let o = 0; o < e.length; o++) {
        const i = e[o];
        t = t || !!i && V in i, e[o] = typeof i == "function" ? (t = !0, w(i)) : i
    }
    if (te && t) return new Proxy({
        get(o) {
            for (let i = e.length - 1; i >= 0; i--) {
                const c = q(e[i])[o];
                if (c !== void 0) return c
            }
        },
        has(o) {
            for (let i = e.length - 1; i >= 0; i--)
                if (o in q(e[i])) return !0;
            return !1
        },
        keys() {
            const o = [];
            for (let i = 0; i < e.length; i++) o.push(...Object.keys(q(e[i])));
            return [...new Set(o)]
        }
    }, H);
    const n = {},
        s = Object.create(null);
    for (let o = e.length - 1; o >= 0; o--) {
        const i = e[o];
        if (!i) continue;
        const c = Object.getOwnPropertyNames(i);
        for (let a = c.length - 1; a >= 0; a--) {
            const u = c[a];
            if (u === "__proto__" || u === "constructor") continue;
            const f = Object.getOwnPropertyDescriptor(i, u);
            if (!s[u]) s[u] = f.get ? {
                enumerable: !0,
                configurable: !0,
                get: Oe.bind(n[u] = [f.get.bind(i)])
            } : f.value !== void 0 ? f : void 0;
            else {
                const d = n[u];
                d && (f.get ? d.push(f.get.bind(i)) : f.value !== void 0 && d.push(() => f.value))
            }
        }
    }
    const l = {},
        r = Object.keys(s);
    for (let o = r.length - 1; o >= 0; o--) {
        const i = r[o],
            c = s[i];
        c && c.get ? Object.defineProperty(l, i, c) : l[i] = c ? c.value : void 0
    }
    return l
}

function et(e, ...t) {
    const n = t.length;
    if (te && V in e) {
        const l = n > 1 ? t.flat() : t[0],
            r = t.map(o => new Proxy({
                get(i) {
                    return o.includes(i) ? e[i] : void 0
                },
                has(i) {
                    return o.includes(i) && i in e
                },
                keys() {
                    return o.filter(i => i in e)
                }
            }, H));
        return r.push(new Proxy({
            get(o) {
                return l.includes(o) ? void 0 : e[o]
            },
            has(o) {
                return l.includes(o) ? !1 : o in e
            },
            keys() {
                return Object.keys(e).filter(o => !l.includes(o))
            }
        }, H)), r
    }
    const s = [];
    for (let l = 0; l <= n; l++) s[l] = {};
    for (const l of Object.getOwnPropertyNames(e)) {
        let r = n;
        for (let c = 0; c < t.length; c++)
            if (t[c].includes(l)) {
                r = c;
                break
            }
        const o = Object.getOwnPropertyDescriptor(e, l);
        !o.get && !o.set && o.enumerable && o.writable && o.configurable ? s[r][l] = o.value : Object.defineProperty(s[r], l, o)
    }
    return s
}
const ue = e => `Stale read from <${e}>.`;

function tt(e) {
    const t = "fallback" in e && {
        fallback: () => e.fallback
    };
    return w(xe(() => e.each, e.children, t || void 0))
}

function nt(e) {
    const t = e.keyed,
        n = w(() => e.when, void 0, void 0),
        s = t ? n : w(n, void 0, {
            equals: (l, r) => !l == !r
        });
    return w(() => {
        const l = s();
        if (l) {
            const r = e.children;
            return typeof r == "function" && r.length > 0 ? m(() => r(t ? l : () => {
                if (!m(s)) throw ue("Show");
                return n()
            })) : r
        }
        return e.fallback
    }, void 0, void 0)
}

function st(e) {
    const t = ie(() => e.children),
        n = w(() => {
            const s = t(),
                l = Array.isArray(s) ? s : [s];
            let r = () => {};
            for (let o = 0; o < l.length; o++) {
                const i = o,
                    c = l[o],
                    a = r,
                    u = w(() => a() ? void 0 : c.when, void 0, void 0),
                    f = c.keyed ? u : w(u, void 0, {
                        equals: (d, y) => !d == !y
                    });
                r = () => a() || (f() ? [i, u, c] : void 0)
            }
            return r
        });
    return w(() => {
        const s = n()();
        if (!s) return e.fallback;
        const [l, r, o] = s, i = o.children;
        return typeof i == "function" && i.length > 0 ? m(() => i(o.keyed ? r() : () => {
            if (m(n)() ?.[0] !== l) throw ue("Match");
            return r()
        })) : i
    }, void 0, void 0)
}

function it(e) {
    return e
}
const $e = ["allowfullscreen", "async", "alpha", "autofocus", "autoplay", "checked", "controls", "default", "disabled", "formnovalidate", "hidden", "indeterminate", "inert", "ismap", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "seamless", "selected", "adauctionheaders", "browsingtopics", "credentialless", "defaultchecked", "defaultmuted", "defaultselected", "defer", "disablepictureinpicture", "disableremoteplayback", "preservespitch", "shadowrootclonable", "shadowrootcustomelementregistry", "shadowrootdelegatesfocus", "shadowrootserializable", "sharedstoragewritable"],
    Te = new Set(["className", "value", "readOnly", "noValidate", "formNoValidate", "isMap", "noModule", "playsInline", "adAuctionHeaders", "allowFullscreen", "browsingTopics", "defaultChecked", "defaultMuted", "defaultSelected", "disablePictureInPicture", "disableRemotePlayback", "preservesPitch", "shadowRootClonable", "shadowRootCustomElementRegistry", "shadowRootDelegatesFocus", "shadowRootSerializable", "sharedStorageWritable", ...$e]),
    Ce = new Set(["innerHTML", "textContent", "innerText", "children"]),
    ke = Object.assign(Object.create(null), {
        className: "class",
        htmlFor: "for"
    }),
    Ne = Object.assign(Object.create(null), {
        class: "className",
        novalidate: {
            $: "noValidate",
            FORM: 1
        },
        formnovalidate: {
            $: "formNoValidate",
            BUTTON: 1,
            INPUT: 1
        },
        ismap: {
            $: "isMap",
            IMG: 1
        },
        nomodule: {
            $: "noModule",
            SCRIPT: 1
        },
        playsinline: {
            $: "playsInline",
            VIDEO: 1
        },
        readonly: {
            $: "readOnly",
            INPUT: 1,
            TEXTAREA: 1
        },
        adauctionheaders: {
            $: "adAuctionHeaders",
            IFRAME: 1
        },
        allowfullscreen: {
            $: "allowFullscreen",
            IFRAME: 1
        },
        browsingtopics: {
            $: "browsingTopics",
            IMG: 1
        },
        defaultchecked: {
            $: "defaultChecked",
            INPUT: 1
        },
        defaultmuted: {
            $: "defaultMuted",
            AUDIO: 1,
            VIDEO: 1
        },
        defaultselected: {
            $: "defaultSelected",
            OPTION: 1
        },
        disablepictureinpicture: {
            $: "disablePictureInPicture",
            VIDEO: 1
        },
        disableremoteplayback: {
            $: "disableRemotePlayback",
            AUDIO: 1,
            VIDEO: 1
        },
        preservespitch: {
            $: "preservesPitch",
            AUDIO: 1,
            VIDEO: 1
        },
        shadowrootclonable: {
            $: "shadowRootClonable",
            TEMPLATE: 1
        },
        shadowrootdelegatesfocus: {
            $: "shadowRootDelegatesFocus",
            TEMPLATE: 1
        },
        shadowrootserializable: {
            $: "shadowRootSerializable",
            TEMPLATE: 1
        },
        sharedstoragewritable: {
            $: "sharedStorageWritable",
            IFRAME: 1,
            IMG: 1
        }
    });

function Ie(e, t) {
    const n = Ne[e];
    return typeof n == "object" ? n[t] ? n.$ : void 0 : n
}
const Le = new Set(["beforeinput", "click", "dblclick", "contextmenu", "focusin", "focusout", "input", "keydown", "keyup", "mousedown", "mousemove", "mouseout", "mouseover", "mouseup", "pointerdown", "pointermove", "pointerout", "pointerover", "pointerup", "touchend", "touchmove", "touchstart"]),
    Me = {
        xlink: "http://www.w3.org/1999/xlink",
        xml: "http://www.w3.org/XML/1998/namespace"
    },
    lt = e => w(() => e());

function De(e, t, n) {
    let s = n.length,
        l = t.length,
        r = s,
        o = 0,
        i = 0,
        c = t[l - 1].nextSibling,
        a = null;
    for (; o < l || i < r;) {
        if (t[o] === n[i]) {
            o++, i++;
            continue
        }
        for (; t[l - 1] === n[r - 1];) l--, r--;
        if (l === o) {
            const u = r < s ? i ? n[i - 1].nextSibling : n[r - i] : c;
            for (; i < r;) e.insertBefore(n[i++], u)
        } else if (r === i)
            for (; o < l;)(!a || !a.has(t[o])) && t[o].remove(), o++;
        else if (t[o] === n[r - 1] && n[i] === t[l - 1]) {
            const u = t[--l].nextSibling;
            e.insertBefore(n[i++], t[o++].nextSibling), e.insertBefore(n[--r], u), t[l] = n[r]
        } else {
            if (!a) {
                a = new Map;
                let f = i;
                for (; f < r;) a.set(n[f], f++)
            }
            const u = a.get(t[o]);
            if (u != null)
                if (i < u && u < r) {
                    let f = o,
                        d = 1,
                        y;
                    for (; ++f < l && f < r && !((y = a.get(t[f])) == null || y !== u + d);) d++;
                    if (d > u - i) {
                        const S = t[o];
                        for (; i < u;) e.insertBefore(n[i++], S)
                    } else e.replaceChild(n[i++], t[o++])
                } else o++;
            else t[o++].remove()
        }
    }
}
const z = "_$DX_DELEGATE";

function ot(e, t, n, s = {}) {
    let l;
    return R(r => {
        l = r, t === document ? e() : ve(t, e(), t.firstChild ? null : void 0, n)
    }, s.owner), () => {
        l(), t.textContent = ""
    }
}

function rt(e, t, n, s) {
    let l;
    const r = () => {
            const i = document.createElement("template");
            return i.innerHTML = e, i.content.firstChild
        },
        o = () => (l || (l = r())).cloneNode(!0);
    return o.cloneNode = o, o
}

function je(e, t = window.document) {
    const n = t[z] || (t[z] = new Set);
    for (let s = 0, l = e.length; s < l; s++) {
        const r = e[s];
        n.has(r) || (n.add(r), t.addEventListener(r, He))
    }
}

function X(e, t, n) {
    n == null ? e.removeAttribute(t) : e.setAttribute(t, n)
}

function Re(e, t, n, s) {
    s == null ? e.removeAttributeNS(t, n) : e.setAttributeNS(t, n, s)
}

function Ve(e, t, n) {
    n ? e.setAttribute(t, "") : e.removeAttribute(t)
}

function Fe(e, t) {
    t == null ? e.removeAttribute("class") : e.className = t
}

function Ue(e, t, n, s) {
    if (s) Array.isArray(n) ? (e[`$$${t}`] = n[0], e[`$$${t}Data`] = n[1]) : e[`$$${t}`] = n;
    else if (Array.isArray(n)) {
        const l = n[0];
        e.addEventListener(t, n[0] = r => l.call(e, n[1], r))
    } else e.addEventListener(t, n, typeof n != "function" && n)
}

function _e(e, t, n = {}) {
    const s = Object.keys(t || {}),
        l = Object.keys(n);
    let r, o;
    for (r = 0, o = l.length; r < o; r++) {
        const i = l[r];
        !i || i === "undefined" || t[i] || (J(e, i, !1), delete n[i])
    }
    for (r = 0, o = s.length; r < o; r++) {
        const i = s[r],
            c = !!t[i];
        !i || i === "undefined" || n[i] === c || !c || (J(e, i, !0), n[i] = c)
    }
    return n
}

function Be(e, t, n) {
    if (!t) return n ? X(e, "style") : t;
    const s = e.style;
    if (typeof t == "string") return s.cssText = t;
    typeof n == "string" && (s.cssText = n = void 0), n || (n = {}), t || (t = {});
    let l, r;
    for (r in n) t[r] == null && s.removeProperty(r), delete n[r];
    for (r in t) l = t[r], l !== n[r] && (s.setProperty(r, l), n[r] = l);
    return n
}

function ct(e, t, n) {
    n != null ? e.style.setProperty(t, n) : e.style.removeProperty(t)
}

function ft(e, t = {}, n, s) {
    const l = {};
    return s || $(() => l.children = I(e, t.children, l.children)), $(() => typeof t.ref == "function" && Ke(t.ref, e)), $(() => qe(e, t, n, !0, l, !0)), l
}

function Ke(e, t, n) {
    return m(() => e(t, n))
}

function ve(e, t, n, s) {
    if (n !== void 0 && !s && (s = []), typeof t != "function") return I(e, t, s, n);
    $(l => I(e, t(), l, n), s)
}

function qe(e, t, n, s, l = {}, r = !1) {
    t || (t = {});
    for (const o in l)
        if (!(o in t)) {
            if (o === "children") continue;
            l[o] = Z(e, o, null, l[o], n, r, t)
        }
    for (const o in t) {
        if (o === "children") continue;
        const i = t[o];
        l[o] = Z(e, o, i, l[o], n, r, t)
    }
}

function Ge(e) {
    return e.toLowerCase().replace(/-([a-z])/g, (t, n) => n.toUpperCase())
}

function J(e, t, n) {
    const s = t.trim().split(/\s+/);
    for (let l = 0, r = s.length; l < r; l++) e.classList.toggle(s[l], n)
}

function Z(e, t, n, s, l, r, o) {
    let i, c, a, u, f;
    if (t === "style") return Be(e, n, s);
    if (t === "classList") return _e(e, n, s);
    if (n === s) return s;
    if (t === "ref") r || n(e);
    else if (t.slice(0, 3) === "on:") {
        const d = t.slice(3);
        s && e.removeEventListener(d, s, typeof s != "function" && s), n && e.addEventListener(d, n, typeof n != "function" && n)
    } else if (t.slice(0, 10) === "oncapture:") {
        const d = t.slice(10);
        s && e.removeEventListener(d, s, !0), n && e.addEventListener(d, n, !0)
    } else if (t.slice(0, 2) === "on") {
        const d = t.slice(2).toLowerCase(),
            y = Le.has(d);
        if (!y && s) {
            const S = Array.isArray(s) ? s[0] : s;
            e.removeEventListener(d, S)
        }(y || n) && (Ue(e, d, n, y), y && je([d]))
    } else if (t.slice(0, 5) === "attr:") X(e, t.slice(5), n);
    else if (t.slice(0, 5) === "bool:") Ve(e, t.slice(5), n);
    else if ((f = t.slice(0, 5) === "prop:") || (a = Ce.has(t)) || !l && ((u = Ie(t, e.tagName)) || (c = Te.has(t))) || (i = e.nodeName.includes("-") || "is" in o)) f && (t = t.slice(5), c = !0), t === "class" || t === "className" ? Fe(e, n) : i && !c && !a ? e[Ge(t)] = n : e[u || t] = n;
    else {
        const d = l && t.indexOf(":") > -1 && Me[t.split(":")[0]];
        d ? Re(e, d, t, n) : X(e, ke[t] || t, n)
    }
    return n
}

function He(e) {
    let t = e.target;
    const n = `$$${e.type}`,
        s = e.target,
        l = e.currentTarget,
        r = c => Object.defineProperty(e, "target", {
            configurable: !0,
            value: c
        }),
        o = () => {
            const c = t[n];
            if (c && !t.disabled) {
                const a = t[`${n}Data`];
                if (a !== void 0 ? c.call(t, a, e) : c.call(t, e), e.cancelBubble) return
            }
            return t.host && typeof t.host != "string" && !t.host._$host && t.contains(e.target) && r(t.host), !0
        },
        i = () => {
            for (; o() && (t = t._$host || t.parentNode || t.host););
        };
    if (Object.defineProperty(e, "currentTarget", {
            configurable: !0,
            get() {
                return t || document
            }
        }), e.composedPath) {
        const c = e.composedPath();
        r(c[0]);
        for (let a = 0; a < c.length - 2 && (t = c[a], !!o()); a++) {
            if (t._$host) {
                t = t._$host, i();
                break
            }
            if (t.parentNode === l) break
        }
    } else i();
    r(s)
}

function I(e, t, n, s, l) {
    for (; typeof n == "function";) n = n();
    if (t === n) return n;
    const r = typeof t,
        o = s !== void 0;
    if (e = o && n[0] && n[0].parentNode || e, r === "string" || r === "number") {
        if (r === "number" && (t = t.toString(), t === n)) return n;
        if (o) {
            let i = n[0];
            i && i.nodeType === 3 ? i.data !== t && (i.data = t) : i = document.createTextNode(t), n = C(e, n, s, i)
        } else n !== "" && typeof n == "string" ? n = e.firstChild.data = t : n = e.textContent = t
    } else if (t == null || r === "boolean") n = C(e, n, s);
    else {
        if (r === "function") return $(() => {
            let i = t();
            for (; typeof i == "function";) i = i();
            n = I(e, i, n, s)
        }), () => n;
        if (Array.isArray(t)) {
            const i = [],
                c = n && Array.isArray(n);
            if (W(i, t, n, l)) return $(() => n = I(e, i, n, s, !0)), () => n;
            if (i.length === 0) {
                if (n = C(e, n, s), o) return n
            } else c ? n.length === 0 ? ee(e, i, s) : De(e, n, i) : (n && C(e), ee(e, i));
            n = i
        } else if (t.nodeType) {
            if (Array.isArray(n)) {
                if (o) return n = C(e, n, s, t);
                C(e, n, null, t)
            } else n == null || n === "" || !e.firstChild ? e.appendChild(t) : e.replaceChild(t, e.firstChild);
            n = t
        }
    }
    return n
}

function W(e, t, n, s) {
    let l = !1;
    for (let r = 0, o = t.length; r < o; r++) {
        let i = t[r],
            c = n && n[e.length],
            a;
        if (!(i == null || i === !0 || i === !1))
            if ((a = typeof i) == "object" && i.nodeType) e.push(i);
            else if (Array.isArray(i)) l = W(e, i, c) || l;
        else if (a === "function")
            if (s) {
                for (; typeof i == "function";) i = i();
                l = W(e, Array.isArray(i) ? i : [i], Array.isArray(c) ? c : [c]) || l
            } else e.push(i), l = !0;
        else {
            const u = String(i);
            c && c.nodeType === 3 && c.data === u ? e.push(c) : e.push(document.createTextNode(u))
        }
    }
    return l
}

function ee(e, t, n = null) {
    for (let s = 0, l = t.length; s < l; s++) e.insertBefore(t[s], n)
}

function C(e, t, n, s) {
    if (n === void 0) return e.textContent = "";
    const l = s || document.createTextNode("");
    if (t.length) {
        let r = !1;
        for (let o = t.length - 1; o >= 0; o--) {
            const i = t[o];
            if (l !== i) {
                const c = i.parentNode === e;
                !r && !o ? c ? e.replaceChild(l, i) : e.insertBefore(l, n) : c && i.remove()
            } else r = !0
        }
    } else e.insertBefore(l, n);
    return [l]
}
export {
    V as $, tt as F, it as M, nt as S, he as a, Xe as b, ye as c, Je as d, Qe as e, lt as f, Ye as g, je as h, ve as i, Ue as j, $ as k, Fe as l, Ze as m, X as n, ct as o, w as p, We as q, we as r, ft as s, rt as t, ze as u, st as v, Be as w, et as x, ot as y
};