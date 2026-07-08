import {
    $ as V,
    b as eo,
    a as Se,
    g as fe,
    c as oo
} from "./solid-CUBEefxS.js";
const be = Symbol("store-raw"),
    W = Symbol("store-node"),
    R = Symbol("store-has"),
    Ge = Symbol("store-self");

function $e(e) {
    let o = e[V];
    if (!o && (Object.defineProperty(e, V, {
            value: o = new Proxy(e, no)
        }), !Array.isArray(e))) {
        const r = Object.keys(e),
            t = Object.getOwnPropertyDescriptors(e);
        for (let n = 0, i = r.length; n < i; n++) {
            const s = r[n];
            t[s].get && Object.defineProperty(e, s, {
                enumerable: t[s].enumerable,
                get: t[s].get.bind(o)
            })
        }
    }
    return o
}

function te(e) {
    let o;
    return e != null && typeof e == "object" && (e[V] || !(o = Object.getPrototypeOf(e)) || o === Object.prototype || Array.isArray(e))
}

function Y(e, o = new Set) {
    let r, t, n, i;
    if (r = e != null && e[be]) return r;
    if (!te(e) || o.has(e)) return e;
    if (Array.isArray(e)) {
        Object.isFrozen(e) ? e = e.slice(0) : o.add(e);
        for (let s = 0, d = e.length; s < d; s++) n = e[s], (t = Y(n, o)) !== n && (e[s] = t)
    } else {
        Object.isFrozen(e) ? e = Object.assign({}, e) : o.add(e);
        const s = Object.keys(e),
            d = Object.getOwnPropertyDescriptors(e);
        for (let l = 0, f = s.length; l < f; l++) i = s[l], !d[i].get && (n = e[i], (t = Y(n, o)) !== n && (e[i] = t))
    }
    return e
}

function ne(e, o) {
    let r = e[o];
    return r || Object.defineProperty(e, o, {
        value: r = Object.create(null)
    }), r
}

function q(e, o, r) {
    if (e[o]) return e[o];
    const [t, n] = oo(r, {
        equals: !1,
        internal: !0
    });
    return t.$ = n, e[o] = t
}

function ro(e, o) {
    const r = Reflect.getOwnPropertyDescriptor(e, o);
    return !r || r.get || !r.configurable || o === V || o === W || (delete r.value, delete r.writable, r.get = () => e[V][o]), r
}

function Ve(e) {
    fe() && q(ne(e, W), Ge)()
}

function to(e) {
    return Ve(e), Reflect.ownKeys(e)
}
const no = {
    get(e, o, r) {
        if (o === be) return e;
        if (o === V) return r;
        if (o === Se) return Ve(e), r;
        const t = ne(e, W),
            n = t[o];
        let i = n ? n() : e[o];
        if (o === W || o === R || o === "__proto__") return i;
        if (!n) {
            const s = Object.getOwnPropertyDescriptor(e, o);
            fe() && (typeof i != "function" || e.hasOwnProperty(o)) && !(s && s.get) && (i = q(t, o, i)())
        }
        return te(i) ? $e(i) : i
    },
    has(e, o) {
        return o === be || o === V || o === Se || o === W || o === R || o === "__proto__" ? !0 : (fe() && q(ne(e, R), o)(), o in e)
    },
    set() {
        return !0
    },
    deleteProperty() {
        return !0
    },
    ownKeys: to,
    getOwnPropertyDescriptor: ro
};

function se(e, o, r, t = !1) {
    if (!t && e[o] === r) return;
    const n = e[o],
        i = e.length;
    r === void 0 ? (delete e[o], e[R] && e[R][o] && n !== void 0 && e[R][o].$()) : (e[o] = r, e[R] && e[R][o] && n === void 0 && e[R][o].$());
    let s = ne(e, W),
        d;
    if ((d = q(s, o, n)) && d.$(() => r), Array.isArray(e) && e.length !== i) {
        for (let l = e.length; l < i; l++)(d = s[l]) && d.$();
        (d = q(s, "length", i)) && d.$(e.length)
    }(d = s[Ge]) && d.$()
}

function Le(e, o) {
    const r = Object.keys(o);
    for (let t = 0; t < r.length; t += 1) {
        const n = r[t];
        se(e, n, o[n])
    }
}

function so(e, o) {
    if (typeof o == "function" && (o = o(e)), o = Y(o), Array.isArray(o)) {
        if (e === o) return;
        let r = 0,
            t = o.length;
        for (; r < t; r++) {
            const n = o[r];
            e[r] !== n && se(e, r, n)
        }
        se(e, "length", t)
    } else Le(e, o)
}

function K(e, o, r = []) {
    let t, n = e;
    if (o.length > 1) {
        t = o.shift();
        const s = typeof t,
            d = Array.isArray(e);
        if (Array.isArray(t)) {
            for (let l = 0; l < t.length; l++) K(e, [t[l]].concat(o), r);
            return
        } else if (d && s === "function") {
            for (let l = 0; l < e.length; l++) t(e[l], l) && K(e, [l].concat(o), r);
            return
        } else if (d && s === "object") {
            const {
                from: l = 0,
                to: f = e.length - 1,
                by: p = 1
            } = t;
            for (let g = l; g <= f; g += p) K(e, [g].concat(o), r);
            return
        } else if (o.length > 1) {
            K(e[t], o, [t].concat(r));
            return
        }
        n = e[t], r = [t].concat(r)
    }
    let i = o[0];
    typeof i == "function" && (i = i(n, r), i === n) || t === void 0 && i == null || (i = Y(i), t === void 0 || te(n) && te(i) && !Array.isArray(i) ? Le(n, i) : se(e, t, i))
}

function Jo(...[e, o]) {
    const r = Y(e || {}),
        t = Array.isArray(r),
        n = $e(r);

    function i(...s) {
        eo(() => {
            t && s.length === 1 ? so(r, s[0]) : K(r, s)
        })
    }
    return [n, i]
}

function _e(e) {
    var o, r, t = "";
    if (typeof e == "string" || typeof e == "number") t += e;
    else if (typeof e == "object")
        if (Array.isArray(e)) {
            var n = e.length;
            for (o = 0; o < n; o++) e[o] && (r = _e(e[o])) && (t && (t += " "), t += r)
        } else
            for (r in e) e[r] && (t && (t += " "), t += r);
    return t
}

function io() {
    for (var e, o, r = 0, t = "", n = arguments.length; r < n; r++)(e = arguments[r]) && (o = _e(e)) && (t && (t += " "), t += o);
    return t
}
const lo = (e, o) => {
        const r = new Array(e.length + o.length);
        for (let t = 0; t < e.length; t++) r[t] = e[t];
        for (let t = 0; t < o.length; t++) r[e.length + t] = o[t];
        return r
    },
    ao = (e, o) => ({
        classGroupId: e,
        validator: o
    }),
    Ee = (e = new Map, o = null, r) => ({
        nextPart: e,
        validators: o,
        classGroupId: r
    }),
    ie = "-",
    Oe = [],
    co = "arbitrary..",
    mo = e => {
        const o = fo(e),
            {
                conflictingClassGroups: r,
                conflictingClassGroupModifiers: t
            } = e;
        return {
            getClassGroupId: s => {
                if (s.startsWith("[") && s.endsWith("]")) return uo(s);
                const d = s.split(ie),
                    l = d[0] === "" && d.length > 1 ? 1 : 0;
                return Fe(d, l, o)
            },
            getConflictingClassGroupIds: (s, d) => {
                if (d) {
                    const l = t[s],
                        f = r[s];
                    return l ? f ? lo(f, l) : l : f || Oe
                }
                return r[s] || Oe
            }
        }
    },
    Fe = (e, o, r) => {
        if (e.length - o === 0) return r.classGroupId;
        const n = e[o],
            i = r.nextPart.get(n);
        if (i) {
            const f = Fe(e, o + 1, i);
            if (f) return f
        }
        const s = r.validators;
        if (s === null) return;
        const d = o === 0 ? e.join(ie) : e.slice(o).join(ie),
            l = s.length;
        for (let f = 0; f < l; f++) {
            const p = s[f];
            if (p.validator(d)) return p.classGroupId
        }
    },
    uo = e => e.slice(1, -1).indexOf(":") === -1 ? void 0 : (() => {
        const o = e.slice(1, -1),
            r = o.indexOf(":"),
            t = o.slice(0, r);
        return t ? co + t : void 0
    })(),
    fo = e => {
        const {
            theme: o,
            classGroups: r
        } = e;
        return bo(r, o)
    },
    bo = (e, o) => {
        const r = Ee();
        for (const t in e) {
            const n = e[t];
            ge(n, r, t, o)
        }
        return r
    },
    ge = (e, o, r, t) => {
        const n = e.length;
        for (let i = 0; i < n; i++) {
            const s = e[i];
            po(s, o, r, t)
        }
    },
    po = (e, o, r, t) => {
        if (typeof e == "string") {
            go(e, o, r);
            return
        }
        if (typeof e == "function") {
            ho(e, o, r, t);
            return
        }
        yo(e, o, r, t)
    },
    go = (e, o, r) => {
        const t = e === "" ? o : We(o, e);
        t.classGroupId = r
    },
    ho = (e, o, r, t) => {
        if (wo(e)) {
            ge(e(t), o, r, t);
            return
        }
        o.validators === null && (o.validators = []), o.validators.push(ao(r, e))
    },
    yo = (e, o, r, t) => {
        const n = Object.entries(e),
            i = n.length;
        for (let s = 0; s < i; s++) {
            const [d, l] = n[s];
            ge(l, We(o, d), r, t)
        }
    },
    We = (e, o) => {
        let r = e;
        const t = o.split(ie),
            n = t.length;
        for (let i = 0; i < n; i++) {
            const s = t[i];
            let d = r.nextPart.get(s);
            d || (d = Ee(), r.nextPart.set(s, d)), r = d
        }
        return r
    },
    wo = e => "isThemeGetter" in e && e.isThemeGetter === !0,
    ko = e => {
        if (e < 1) return {
            get: () => {},
            set: () => {}
        };
        let o = 0,
            r = Object.create(null),
            t = Object.create(null);
        const n = (i, s) => {
            r[i] = s, o++, o > e && (o = 0, t = r, r = Object.create(null))
        };
        return {
            get(i) {
                let s = r[i];
                if (s !== void 0) return s;
                if ((s = t[i]) !== void 0) return n(i, s), s
            },
            set(i, s) {
                i in r ? r[i] = s : n(i, s)
            }
        }
    },
    pe = "!",
    Pe = ":",
    xo = [],
    Re = (e, o, r, t, n) => ({
        modifiers: e,
        hasImportantModifier: o,
        baseClassName: r,
        maybePostfixModifierPosition: t,
        isExternal: n
    }),
    vo = e => {
        const {
            prefix: o,
            experimentalParseClassName: r
        } = e;
        let t = n => {
            const i = [];
            let s = 0,
                d = 0,
                l = 0,
                f;
            const p = n.length;
            for (let A = 0; A < p; A++) {
                const k = n[A];
                if (s === 0 && d === 0) {
                    if (k === Pe) {
                        i.push(n.slice(l, A)), l = A + 1;
                        continue
                    }
                    if (k === "/") {
                        f = A;
                        continue
                    }
                }
                k === "[" ? s++ : k === "]" ? s-- : k === "(" ? d++ : k === ")" && d--
            }
            const g = i.length === 0 ? n : n.slice(l);
            let w = g,
                S = !1;
            g.endsWith(pe) ? (w = g.slice(0, -1), S = !0) : g.startsWith(pe) && (w = g.slice(1), S = !0);
            const O = f && f > l ? f - l : void 0;
            return Re(i, S, w, O)
        };
        if (o) {
            const n = o + Pe,
                i = t;
            t = s => s.startsWith(n) ? i(s.slice(n.length)) : Re(xo, !1, s, void 0, !0)
        }
        if (r) {
            const n = t;
            t = i => r({
                className: i,
                parseClassName: n
            })
        }
        return t
    },
    Ao = e => {
        const o = new Map;
        return e.orderSensitiveModifiers.forEach((r, t) => {
            o.set(r, 1e6 + t)
        }), r => {
            const t = [];
            let n = [];
            for (let i = 0; i < r.length; i++) {
                const s = r[i],
                    d = s[0] === "[",
                    l = o.has(s);
                d || l ? (n.length > 0 && (n.sort(), t.push(...n), n = []), t.push(s)) : n.push(s)
            }
            return n.length > 0 && (n.sort(), t.push(...n)), t
        }
    },
    zo = e => ({
        cache: ko(e.cacheSize),
        parseClassName: vo(e),
        sortModifiers: Ao(e),
        ...mo(e)
    }),
    Co = /\s+/,
    So = (e, o) => {
        const {
            parseClassName: r,
            getClassGroupId: t,
            getConflictingClassGroupIds: n,
            sortModifiers: i
        } = o, s = [], d = e.trim().split(Co);
        let l = "";
        for (let f = d.length - 1; f >= 0; f -= 1) {
            const p = d[f],
                {
                    isExternal: g,
                    modifiers: w,
                    hasImportantModifier: S,
                    baseClassName: O,
                    maybePostfixModifierPosition: A
                } = r(p);
            if (g) {
                l = p + (l.length > 0 ? " " + l : l);
                continue
            }
            let k = !!A,
                T = t(k ? O.substring(0, A) : O);
            if (!T) {
                if (!k) {
                    l = p + (l.length > 0 ? " " + l : l);
                    continue
                }
                if (T = t(O), !T) {
                    l = p + (l.length > 0 ? " " + l : l);
                    continue
                }
                k = !1
            }
            const X = w.length === 0 ? "" : w.length === 1 ? w[0] : i(w).join(":"),
                D = S ? X + pe : X,
                _ = D + T;
            if (s.indexOf(_) > -1) continue;
            s.push(_);
            const E = n(T, k);
            for (let N = 0; N < E.length; ++N) {
                const B = E[N];
                s.push(D + B)
            }
            l = p + (l.length > 0 ? " " + l : l)
        }
        return l
    },
    Oo = (...e) => {
        let o = 0,
            r, t, n = "";
        for (; o < e.length;)(r = e[o++]) && (t = De(r)) && (n && (n += " "), n += t);
        return n
    },
    De = e => {
        if (typeof e == "string") return e;
        let o, r = "";
        for (let t = 0; t < e.length; t++) e[t] && (o = De(e[t])) && (r && (r += " "), r += o);
        return r
    },
    Po = (e, ...o) => {
        let r, t, n, i;
        const s = l => {
                const f = o.reduce((p, g) => g(p), e());
                return r = zo(f), t = r.cache.get, n = r.cache.set, i = d, d(l)
            },
            d = l => {
                const f = t(l);
                if (f) return f;
                const p = So(l, r);
                return n(l, p), p
            };
        return i = s, (...l) => i(Oo(...l))
    },
    Ro = [],
    h = e => {
        const o = r => r[e] || Ro;
        return o.isThemeGetter = !0, o
    },
    Be = /^\[(?:(\w[\w-]*):)?(.+)\]$/i,
    Ue = /^\((?:(\w[\w-]*):)?(.+)\)$/i,
    jo = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/,
    Io = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/,
    Mo = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/,
    To = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/,
    No = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/,
    Go = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/,
    j = e => jo.test(e),
    b = e => !!e && !Number.isNaN(Number(e)),
    I = e => !!e && Number.isInteger(Number(e)),
    ue = e => e.endsWith("%") && b(e.slice(0, -1)),
    P = e => Io.test(e),
    Ke = () => !0,
    $o = e => Mo.test(e) && !To.test(e),
    he = () => !1,
    Vo = e => No.test(e),
    Lo = e => Go.test(e),
    _o = e => !a(e) && !c(e),
    Eo = e => M(e, Xe, he),
    a = e => Be.test(e),
    $ = e => M(e, He, $o),
    je = e => M(e, qo, b),
    Fo = e => M(e, Qe, Ke),
    Wo = e => M(e, Je, he),
    Ie = e => M(e, Ye, he),
    Do = e => M(e, qe, Lo),
    oe = e => M(e, Ze, Vo),
    c = e => Ue.test(e),
    U = e => L(e, He),
    Bo = e => L(e, Je),
    Me = e => L(e, Ye),
    Uo = e => L(e, Xe),
    Ko = e => L(e, qe),
    re = e => L(e, Ze, !0),
    Yo = e => L(e, Qe, !0),
    M = (e, o, r) => {
        const t = Be.exec(e);
        return t ? t[1] ? o(t[1]) : r(t[2]) : !1
    },
    L = (e, o, r = !1) => {
        const t = Ue.exec(e);
        return t ? t[1] ? o(t[1]) : r : !1
    },
    Ye = e => e === "position" || e === "percentage",
    qe = e => e === "image" || e === "url",
    Xe = e => e === "length" || e === "size" || e === "bg-size",
    He = e => e === "length",
    qo = e => e === "number",
    Je = e => e === "family-name",
    Qe = e => e === "number" || e === "weight",
    Ze = e => e === "shadow",
    Xo = () => {
        const e = h("color"),
            o = h("font"),
            r = h("text"),
            t = h("font-weight"),
            n = h("tracking"),
            i = h("leading"),
            s = h("breakpoint"),
            d = h("container"),
            l = h("spacing"),
            f = h("radius"),
            p = h("shadow"),
            g = h("inset-shadow"),
            w = h("text-shadow"),
            S = h("drop-shadow"),
            O = h("blur"),
            A = h("perspective"),
            k = h("aspect"),
            T = h("ease"),
            X = h("animate"),
            D = () => ["auto", "avoid", "all", "avoid-page", "page", "left", "right", "column"],
            _ = () => ["center", "top", "bottom", "left", "right", "top-left", "left-top", "top-right", "right-top", "bottom-right", "right-bottom", "bottom-left", "left-bottom"],
            E = () => [..._(), c, a],
            N = () => ["auto", "hidden", "clip", "visible", "scroll"],
            B = () => ["auto", "contain", "none"],
            m = () => [c, a, l],
            z = () => [j, "full", "auto", ...m()],
            ye = () => [I, "none", "subgrid", c, a],
            we = () => ["auto", {
                span: ["full", I, c, a]
            }, I, c, a],
            H = () => [I, "auto", c, a],
            ke = () => ["auto", "min", "max", "fr", c, a],
            le = () => ["start", "end", "center", "between", "around", "evenly", "stretch", "baseline", "center-safe", "end-safe"],
            F = () => ["start", "end", "center", "stretch", "center-safe", "end-safe"],
            C = () => ["auto", ...m()],
            G = () => [j, "auto", "full", "dvw", "dvh", "lvw", "lvh", "svw", "svh", "min", "max", "fit", ...m()],
            ae = () => [j, "screen", "full", "dvw", "lvw", "svw", "min", "max", "fit", ...m()],
            ce = () => [j, "screen", "full", "lh", "dvh", "lvh", "svh", "min", "max", "fit", ...m()],
            u = () => [e, c, a],
            xe = () => [..._(), Me, Ie, {
                position: [c, a]
            }],
            ve = () => ["no-repeat", {
                repeat: ["", "x", "y", "space", "round"]
            }],
            Ae = () => ["auto", "cover", "contain", Uo, Eo, {
                size: [c, a]
            }],
            de = () => [ue, U, $],
            x = () => ["", "none", "full", f, c, a],
            v = () => ["", b, U, $],
            J = () => ["solid", "dashed", "dotted", "double"],
            ze = () => ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"],
            y = () => [b, ue, Me, Ie],
            Ce = () => ["", "none", O, c, a],
            Q = () => ["none", b, c, a],
            Z = () => ["none", b, c, a],
            me = () => [b, c, a],
            ee = () => [j, "full", ...m()];
        return {
            cacheSize: 500,
            theme: {
                animate: ["spin", "ping", "pulse", "bounce"],
                aspect: ["video"],
                blur: [P],
                breakpoint: [P],
                color: [Ke],
                container: [P],
                "drop-shadow": [P],
                ease: ["in", "out", "in-out"],
                font: [_o],
                "font-weight": ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"],
                "inset-shadow": [P],
                leading: ["none", "tight", "snug", "normal", "relaxed", "loose"],
                perspective: ["dramatic", "near", "normal", "midrange", "distant", "none"],
                radius: [P],
                shadow: [P],
                spacing: ["px", b],
                text: [P],
                "text-shadow": [P],
                tracking: ["tighter", "tight", "normal", "wide", "wider", "widest"]
            },
            classGroups: {
                aspect: [{
                    aspect: ["auto", "square", j, a, c, k]
                }],
                container: ["container"],
                columns: [{
                    columns: [b, a, c, d]
                }],
                "break-after": [{
                    "break-after": D()
                }],
                "break-before": [{
                    "break-before": D()
                }],
                "break-inside": [{
                    "break-inside": ["auto", "avoid", "avoid-page", "avoid-column"]
                }],
                "box-decoration": [{
                    "box-decoration": ["slice", "clone"]
                }],
                box: [{
                    box: ["border", "content"]
                }],
                display: ["block", "inline-block", "inline", "flex", "inline-flex", "table", "inline-table", "table-caption", "table-cell", "table-column", "table-column-group", "table-footer-group", "table-header-group", "table-row-group", "table-row", "flow-root", "grid", "inline-grid", "contents", "list-item", "hidden"],
                sr: ["sr-only", "not-sr-only"],
                float: [{
                    float: ["right", "left", "none", "start", "end"]
                }],
                clear: [{
                    clear: ["left", "right", "both", "none", "start", "end"]
                }],
                isolation: ["isolate", "isolation-auto"],
                "object-fit": [{
                    object: ["contain", "cover", "fill", "none", "scale-down"]
                }],
                "object-position": [{
                    object: E()
                }],
                overflow: [{
                    overflow: N()
                }],
                "overflow-x": [{
                    "overflow-x": N()
                }],
                "overflow-y": [{
                    "overflow-y": N()
                }],
                overscroll: [{
                    overscroll: B()
                }],
                "overscroll-x": [{
                    "overscroll-x": B()
                }],
                "overscroll-y": [{
                    "overscroll-y": B()
                }],
                position: ["static", "fixed", "absolute", "relative", "sticky"],
                inset: [{
                    inset: z()
                }],
                "inset-x": [{
                    "inset-x": z()
                }],
                "inset-y": [{
                    "inset-y": z()
                }],
                start: [{
                    "inset-s": z(),
                    start: z()
                }],
                end: [{
                    "inset-e": z(),
                    end: z()
                }],
                "inset-bs": [{
                    "inset-bs": z()
                }],
                "inset-be": [{
                    "inset-be": z()
                }],
                top: [{
                    top: z()
                }],
                right: [{
                    right: z()
                }],
                bottom: [{
                    bottom: z()
                }],
                left: [{
                    left: z()
                }],
                visibility: ["visible", "invisible", "collapse"],
                z: [{
                    z: [I, "auto", c, a]
                }],
                basis: [{
                    basis: [j, "full", "auto", d, ...m()]
                }],
                "flex-direction": [{
                    flex: ["row", "row-reverse", "col", "col-reverse"]
                }],
                "flex-wrap": [{
                    flex: ["nowrap", "wrap", "wrap-reverse"]
                }],
                flex: [{
                    flex: [b, j, "auto", "initial", "none", a]
                }],
                grow: [{
                    grow: ["", b, c, a]
                }],
                shrink: [{
                    shrink: ["", b, c, a]
                }],
                order: [{
                    order: [I, "first", "last", "none", c, a]
                }],
                "grid-cols": [{
                    "grid-cols": ye()
                }],
                "col-start-end": [{
                    col: we()
                }],
                "col-start": [{
                    "col-start": H()
                }],
                "col-end": [{
                    "col-end": H()
                }],
                "grid-rows": [{
                    "grid-rows": ye()
                }],
                "row-start-end": [{
                    row: we()
                }],
                "row-start": [{
                    "row-start": H()
                }],
                "row-end": [{
                    "row-end": H()
                }],
                "grid-flow": [{
                    "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"]
                }],
                "auto-cols": [{
                    "auto-cols": ke()
                }],
                "auto-rows": [{
                    "auto-rows": ke()
                }],
                gap: [{
                    gap: m()
                }],
                "gap-x": [{
                    "gap-x": m()
                }],
                "gap-y": [{
                    "gap-y": m()
                }],
                "justify-content": [{
                    justify: [...le(), "normal"]
                }],
                "justify-items": [{
                    "justify-items": [...F(), "normal"]
                }],
                "justify-self": [{
                    "justify-self": ["auto", ...F()]
                }],
                "align-content": [{
                    content: ["normal", ...le()]
                }],
                "align-items": [{
                    items: [...F(), {
                        baseline: ["", "last"]
                    }]
                }],
                "align-self": [{
                    self: ["auto", ...F(), {
                        baseline: ["", "last"]
                    }]
                }],
                "place-content": [{
                    "place-content": le()
                }],
                "place-items": [{
                    "place-items": [...F(), "baseline"]
                }],
                "place-self": [{
                    "place-self": ["auto", ...F()]
                }],
                p: [{
                    p: m()
                }],
                px: [{
                    px: m()
                }],
                py: [{
                    py: m()
                }],
                ps: [{
                    ps: m()
                }],
                pe: [{
                    pe: m()
                }],
                pbs: [{
                    pbs: m()
                }],
                pbe: [{
                    pbe: m()
                }],
                pt: [{
                    pt: m()
                }],
                pr: [{
                    pr: m()
                }],
                pb: [{
                    pb: m()
                }],
                pl: [{
                    pl: m()
                }],
                m: [{
                    m: C()
                }],
                mx: [{
                    mx: C()
                }],
                my: [{
                    my: C()
                }],
                ms: [{
                    ms: C()
                }],
                me: [{
                    me: C()
                }],
                mbs: [{
                    mbs: C()
                }],
                mbe: [{
                    mbe: C()
                }],
                mt: [{
                    mt: C()
                }],
                mr: [{
                    mr: C()
                }],
                mb: [{
                    mb: C()
                }],
                ml: [{
                    ml: C()
                }],
                "space-x": [{
                    "space-x": m()
                }],
                "space-x-reverse": ["space-x-reverse"],
                "space-y": [{
                    "space-y": m()
                }],
                "space-y-reverse": ["space-y-reverse"],
                size: [{
                    size: G()
                }],
                "inline-size": [{
                    inline: ["auto", ...ae()]
                }],
                "min-inline-size": [{
                    "min-inline": ["auto", ...ae()]
                }],
                "max-inline-size": [{
                    "max-inline": ["none", ...ae()]
                }],
                "block-size": [{
                    block: ["auto", ...ce()]
                }],
                "min-block-size": [{
                    "min-block": ["auto", ...ce()]
                }],
                "max-block-size": [{
                    "max-block": ["none", ...ce()]
                }],
                w: [{
                    w: [d, "screen", ...G()]
                }],
                "min-w": [{
                    "min-w": [d, "screen", "none", ...G()]
                }],
                "max-w": [{
                    "max-w": [d, "screen", "none", "prose", {
                        screen: [s]
                    }, ...G()]
                }],
                h: [{
                    h: ["screen", "lh", ...G()]
                }],
                "min-h": [{
                    "min-h": ["screen", "lh", "none", ...G()]
                }],
                "max-h": [{
                    "max-h": ["screen", "lh", ...G()]
                }],
                "font-size": [{
                    text: ["base", r, U, $]
                }],
                "font-smoothing": ["antialiased", "subpixel-antialiased"],
                "font-style": ["italic", "not-italic"],
                "font-weight": [{
                    font: [t, Yo, Fo]
                }],
                "font-stretch": [{
                    "font-stretch": ["ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "normal", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded", ue, a]
                }],
                "font-family": [{
                    font: [Bo, Wo, o]
                }],
                "font-features": [{
                    "font-features": [a]
                }],
                "fvn-normal": ["normal-nums"],
                "fvn-ordinal": ["ordinal"],
                "fvn-slashed-zero": ["slashed-zero"],
                "fvn-figure": ["lining-nums", "oldstyle-nums"],
                "fvn-spacing": ["proportional-nums", "tabular-nums"],
                "fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
                tracking: [{
                    tracking: [n, c, a]
                }],
                "line-clamp": [{
                    "line-clamp": [b, "none", c, je]
                }],
                leading: [{
                    leading: [i, ...m()]
                }],
                "list-image": [{
                    "list-image": ["none", c, a]
                }],
                "list-style-position": [{
                    list: ["inside", "outside"]
                }],
                "list-style-type": [{
                    list: ["disc", "decimal", "none", c, a]
                }],
                "text-alignment": [{
                    text: ["left", "center", "right", "justify", "start", "end"]
                }],
                "placeholder-color": [{
                    placeholder: u()
                }],
                "text-color": [{
                    text: u()
                }],
                "text-decoration": ["underline", "overline", "line-through", "no-underline"],
                "text-decoration-style": [{
                    decoration: [...J(), "wavy"]
                }],
                "text-decoration-thickness": [{
                    decoration: [b, "from-font", "auto", c, $]
                }],
                "text-decoration-color": [{
                    decoration: u()
                }],
                "underline-offset": [{
                    "underline-offset": [b, "auto", c, a]
                }],
                "text-transform": ["uppercase", "lowercase", "capitalize", "normal-case"],
                "text-overflow": ["truncate", "text-ellipsis", "text-clip"],
                "text-wrap": [{
                    text: ["wrap", "nowrap", "balance", "pretty"]
                }],
                indent: [{
                    indent: m()
                }],
                "vertical-align": [{
                    align: ["baseline", "top", "middle", "bottom", "text-top", "text-bottom", "sub", "super", c, a]
                }],
                whitespace: [{
                    whitespace: ["normal", "nowrap", "pre", "pre-line", "pre-wrap", "break-spaces"]
                }],
                break: [{
                    break: ["normal", "words", "all", "keep"]
                }],
                wrap: [{
                    wrap: ["break-word", "anywhere", "normal"]
                }],
                hyphens: [{
                    hyphens: ["none", "manual", "auto"]
                }],
                content: [{
                    content: ["none", c, a]
                }],
                "bg-attachment": [{
                    bg: ["fixed", "local", "scroll"]
                }],
                "bg-clip": [{
                    "bg-clip": ["border", "padding", "content", "text"]
                }],
                "bg-origin": [{
                    "bg-origin": ["border", "padding", "content"]
                }],
                "bg-position": [{
                    bg: xe()
                }],
                "bg-repeat": [{
                    bg: ve()
                }],
                "bg-size": [{
                    bg: Ae()
                }],
                "bg-image": [{
                    bg: ["none", {
                        linear: [{
                            to: ["t", "tr", "r", "br", "b", "bl", "l", "tl"]
                        }, I, c, a],
                        radial: ["", c, a],
                        conic: [I, c, a]
                    }, Ko, Do]
                }],
                "bg-color": [{
                    bg: u()
                }],
                "gradient-from-pos": [{
                    from: de()
                }],
                "gradient-via-pos": [{
                    via: de()
                }],
                "gradient-to-pos": [{
                    to: de()
                }],
                "gradient-from": [{
                    from: u()
                }],
                "gradient-via": [{
                    via: u()
                }],
                "gradient-to": [{
                    to: u()
                }],
                rounded: [{
                    rounded: x()
                }],
                "rounded-s": [{
                    "rounded-s": x()
                }],
                "rounded-e": [{
                    "rounded-e": x()
                }],
                "rounded-t": [{
                    "rounded-t": x()
                }],
                "rounded-r": [{
                    "rounded-r": x()
                }],
                "rounded-b": [{
                    "rounded-b": x()
                }],
                "rounded-l": [{
                    "rounded-l": x()
                }],
                "rounded-ss": [{
                    "rounded-ss": x()
                }],
                "rounded-se": [{
                    "rounded-se": x()
                }],
                "rounded-ee": [{
                    "rounded-ee": x()
                }],
                "rounded-es": [{
                    "rounded-es": x()
                }],
                "rounded-tl": [{
                    "rounded-tl": x()
                }],
                "rounded-tr": [{
                    "rounded-tr": x()
                }],
                "rounded-br": [{
                    "rounded-br": x()
                }],
                "rounded-bl": [{
                    "rounded-bl": x()
                }],
                "border-w": [{
                    border: v()
                }],
                "border-w-x": [{
                    "border-x": v()
                }],
                "border-w-y": [{
                    "border-y": v()
                }],
                "border-w-s": [{
                    "border-s": v()
                }],
                "border-w-e": [{
                    "border-e": v()
                }],
                "border-w-bs": [{
                    "border-bs": v()
                }],
                "border-w-be": [{
                    "border-be": v()
                }],
                "border-w-t": [{
                    "border-t": v()
                }],
                "border-w-r": [{
                    "border-r": v()
                }],
                "border-w-b": [{
                    "border-b": v()
                }],
                "border-w-l": [{
                    "border-l": v()
                }],
                "divide-x": [{
                    "divide-x": v()
                }],
                "divide-x-reverse": ["divide-x-reverse"],
                "divide-y": [{
                    "divide-y": v()
                }],
                "divide-y-reverse": ["divide-y-reverse"],
                "border-style": [{
                    border: [...J(), "hidden", "none"]
                }],
                "divide-style": [{
                    divide: [...J(), "hidden", "none"]
                }],
                "border-color": [{
                    border: u()
                }],
                "border-color-x": [{
                    "border-x": u()
                }],
                "border-color-y": [{
                    "border-y": u()
                }],
                "border-color-s": [{
                    "border-s": u()
                }],
                "border-color-e": [{
                    "border-e": u()
                }],
                "border-color-bs": [{
                    "border-bs": u()
                }],
                "border-color-be": [{
                    "border-be": u()
                }],
                "border-color-t": [{
                    "border-t": u()
                }],
                "border-color-r": [{
                    "border-r": u()
                }],
                "border-color-b": [{
                    "border-b": u()
                }],
                "border-color-l": [{
                    "border-l": u()
                }],
                "divide-color": [{
                    divide: u()
                }],
                "outline-style": [{
                    outline: [...J(), "none", "hidden"]
                }],
                "outline-offset": [{
                    "outline-offset": [b, c, a]
                }],
                "outline-w": [{
                    outline: ["", b, U, $]
                }],
                "outline-color": [{
                    outline: u()
                }],
                shadow: [{
                    shadow: ["", "none", p, re, oe]
                }],
                "shadow-color": [{
                    shadow: u()
                }],
                "inset-shadow": [{
                    "inset-shadow": ["none", g, re, oe]
                }],
                "inset-shadow-color": [{
                    "inset-shadow": u()
                }],
                "ring-w": [{
                    ring: v()
                }],
                "ring-w-inset": ["ring-inset"],
                "ring-color": [{
                    ring: u()
                }],
                "ring-offset-w": [{
                    "ring-offset": [b, $]
                }],
                "ring-offset-color": [{
                    "ring-offset": u()
                }],
                "inset-ring-w": [{
                    "inset-ring": v()
                }],
                "inset-ring-color": [{
                    "inset-ring": u()
                }],
                "text-shadow": [{
                    "text-shadow": ["none", w, re, oe]
                }],
                "text-shadow-color": [{
                    "text-shadow": u()
                }],
                opacity: [{
                    opacity: [b, c, a]
                }],
                "mix-blend": [{
                    "mix-blend": [...ze(), "plus-darker", "plus-lighter"]
                }],
                "bg-blend": [{
                    "bg-blend": ze()
                }],
                "mask-clip": [{
                    "mask-clip": ["border", "padding", "content", "fill", "stroke", "view"]
                }, "mask-no-clip"],
                "mask-composite": [{
                    mask: ["add", "subtract", "intersect", "exclude"]
                }],
                "mask-image-linear-pos": [{
                    "mask-linear": [b]
                }],
                "mask-image-linear-from-pos": [{
                    "mask-linear-from": y()
                }],
                "mask-image-linear-to-pos": [{
                    "mask-linear-to": y()
                }],
                "mask-image-linear-from-color": [{
                    "mask-linear-from": u()
                }],
                "mask-image-linear-to-color": [{
                    "mask-linear-to": u()
                }],
                "mask-image-t-from-pos": [{
                    "mask-t-from": y()
                }],
                "mask-image-t-to-pos": [{
                    "mask-t-to": y()
                }],
                "mask-image-t-from-color": [{
                    "mask-t-from": u()
                }],
                "mask-image-t-to-color": [{
                    "mask-t-to": u()
                }],
                "mask-image-r-from-pos": [{
                    "mask-r-from": y()
                }],
                "mask-image-r-to-pos": [{
                    "mask-r-to": y()
                }],
                "mask-image-r-from-color": [{
                    "mask-r-from": u()
                }],
                "mask-image-r-to-color": [{
                    "mask-r-to": u()
                }],
                "mask-image-b-from-pos": [{
                    "mask-b-from": y()
                }],
                "mask-image-b-to-pos": [{
                    "mask-b-to": y()
                }],
                "mask-image-b-from-color": [{
                    "mask-b-from": u()
                }],
                "mask-image-b-to-color": [{
                    "mask-b-to": u()
                }],
                "mask-image-l-from-pos": [{
                    "mask-l-from": y()
                }],
                "mask-image-l-to-pos": [{
                    "mask-l-to": y()
                }],
                "mask-image-l-from-color": [{
                    "mask-l-from": u()
                }],
                "mask-image-l-to-color": [{
                    "mask-l-to": u()
                }],
                "mask-image-x-from-pos": [{
                    "mask-x-from": y()
                }],
                "mask-image-x-to-pos": [{
                    "mask-x-to": y()
                }],
                "mask-image-x-from-color": [{
                    "mask-x-from": u()
                }],
                "mask-image-x-to-color": [{
                    "mask-x-to": u()
                }],
                "mask-image-y-from-pos": [{
                    "mask-y-from": y()
                }],
                "mask-image-y-to-pos": [{
                    "mask-y-to": y()
                }],
                "mask-image-y-from-color": [{
                    "mask-y-from": u()
                }],
                "mask-image-y-to-color": [{
                    "mask-y-to": u()
                }],
                "mask-image-radial": [{
                    "mask-radial": [c, a]
                }],
                "mask-image-radial-from-pos": [{
                    "mask-radial-from": y()
                }],
                "mask-image-radial-to-pos": [{
                    "mask-radial-to": y()
                }],
                "mask-image-radial-from-color": [{
                    "mask-radial-from": u()
                }],
                "mask-image-radial-to-color": [{
                    "mask-radial-to": u()
                }],
                "mask-image-radial-shape": [{
                    "mask-radial": ["circle", "ellipse"]
                }],
                "mask-image-radial-size": [{
                    "mask-radial": [{
                        closest: ["side", "corner"],
                        farthest: ["side", "corner"]
                    }]
                }],
                "mask-image-radial-pos": [{
                    "mask-radial-at": _()
                }],
                "mask-image-conic-pos": [{
                    "mask-conic": [b]
                }],
                "mask-image-conic-from-pos": [{
                    "mask-conic-from": y()
                }],
                "mask-image-conic-to-pos": [{
                    "mask-conic-to": y()
                }],
                "mask-image-conic-from-color": [{
                    "mask-conic-from": u()
                }],
                "mask-image-conic-to-color": [{
                    "mask-conic-to": u()
                }],
                "mask-mode": [{
                    mask: ["alpha", "luminance", "match"]
                }],
                "mask-origin": [{
                    "mask-origin": ["border", "padding", "content", "fill", "stroke", "view"]
                }],
                "mask-position": [{
                    mask: xe()
                }],
                "mask-repeat": [{
                    mask: ve()
                }],
                "mask-size": [{
                    mask: Ae()
                }],
                "mask-type": [{
                    "mask-type": ["alpha", "luminance"]
                }],
                "mask-image": [{
                    mask: ["none", c, a]
                }],
                filter: [{
                    filter: ["", "none", c, a]
                }],
                blur: [{
                    blur: Ce()
                }],
                brightness: [{
                    brightness: [b, c, a]
                }],
                contrast: [{
                    contrast: [b, c, a]
                }],
                "drop-shadow": [{
                    "drop-shadow": ["", "none", S, re, oe]
                }],
                "drop-shadow-color": [{
                    "drop-shadow": u()
                }],
                grayscale: [{
                    grayscale: ["", b, c, a]
                }],
                "hue-rotate": [{
                    "hue-rotate": [b, c, a]
                }],
                invert: [{
                    invert: ["", b, c, a]
                }],
                saturate: [{
                    saturate: [b, c, a]
                }],
                sepia: [{
                    sepia: ["", b, c, a]
                }],
                "backdrop-filter": [{
                    "backdrop-filter": ["", "none", c, a]
                }],
                "backdrop-blur": [{
                    "backdrop-blur": Ce()
                }],
                "backdrop-brightness": [{
                    "backdrop-brightness": [b, c, a]
                }],
                "backdrop-contrast": [{
                    "backdrop-contrast": [b, c, a]
                }],
                "backdrop-grayscale": [{
                    "backdrop-grayscale": ["", b, c, a]
                }],
                "backdrop-hue-rotate": [{
                    "backdrop-hue-rotate": [b, c, a]
                }],
                "backdrop-invert": [{
                    "backdrop-invert": ["", b, c, a]
                }],
                "backdrop-opacity": [{
                    "backdrop-opacity": [b, c, a]
                }],
                "backdrop-saturate": [{
                    "backdrop-saturate": [b, c, a]
                }],
                "backdrop-sepia": [{
                    "backdrop-sepia": ["", b, c, a]
                }],
                "border-collapse": [{
                    border: ["collapse", "separate"]
                }],
                "border-spacing": [{
                    "border-spacing": m()
                }],
                "border-spacing-x": [{
                    "border-spacing-x": m()
                }],
                "border-spacing-y": [{
                    "border-spacing-y": m()
                }],
                "table-layout": [{
                    table: ["auto", "fixed"]
                }],
                caption: [{
                    caption: ["top", "bottom"]
                }],
                transition: [{
                    transition: ["", "all", "colors", "opacity", "shadow", "transform", "none", c, a]
                }],
                "transition-behavior": [{
                    transition: ["normal", "discrete"]
                }],
                duration: [{
                    duration: [b, "initial", c, a]
                }],
                ease: [{
                    ease: ["linear", "initial", T, c, a]
                }],
                delay: [{
                    delay: [b, c, a]
                }],
                animate: [{
                    animate: ["none", X, c, a]
                }],
                backface: [{
                    backface: ["hidden", "visible"]
                }],
                perspective: [{
                    perspective: [A, c, a]
                }],
                "perspective-origin": [{
                    "perspective-origin": E()
                }],
                rotate: [{
                    rotate: Q()
                }],
                "rotate-x": [{
                    "rotate-x": Q()
                }],
                "rotate-y": [{
                    "rotate-y": Q()
                }],
                "rotate-z": [{
                    "rotate-z": Q()
                }],
                scale: [{
                    scale: Z()
                }],
                "scale-x": [{
                    "scale-x": Z()
                }],
                "scale-y": [{
                    "scale-y": Z()
                }],
                "scale-z": [{
                    "scale-z": Z()
                }],
                "scale-3d": ["scale-3d"],
                skew: [{
                    skew: me()
                }],
                "skew-x": [{
                    "skew-x": me()
                }],
                "skew-y": [{
                    "skew-y": me()
                }],
                transform: [{
                    transform: [c, a, "", "none", "gpu", "cpu"]
                }],
                "transform-origin": [{
                    origin: E()
                }],
                "transform-style": [{
                    transform: ["3d", "flat"]
                }],
                translate: [{
                    translate: ee()
                }],
                "translate-x": [{
                    "translate-x": ee()
                }],
                "translate-y": [{
                    "translate-y": ee()
                }],
                "translate-z": [{
                    "translate-z": ee()
                }],
                "translate-none": ["translate-none"],
                accent: [{
                    accent: u()
                }],
                appearance: [{
                    appearance: ["none", "auto"]
                }],
                "caret-color": [{
                    caret: u()
                }],
                "color-scheme": [{
                    scheme: ["normal", "dark", "light", "light-dark", "only-dark", "only-light"]
                }],
                cursor: [{
                    cursor: ["auto", "default", "pointer", "wait", "text", "move", "help", "not-allowed", "none", "context-menu", "progress", "cell", "crosshair", "vertical-text", "alias", "copy", "no-drop", "grab", "grabbing", "all-scroll", "col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out", c, a]
                }],
                "field-sizing": [{
                    "field-sizing": ["fixed", "content"]
                }],
                "pointer-events": [{
                    "pointer-events": ["auto", "none"]
                }],
                resize: [{
                    resize: ["none", "", "y", "x"]
                }],
                "scroll-behavior": [{
                    scroll: ["auto", "smooth"]
                }],
                "scroll-m": [{
                    "scroll-m": m()
                }],
                "scroll-mx": [{
                    "scroll-mx": m()
                }],
                "scroll-my": [{
                    "scroll-my": m()
                }],
                "scroll-ms": [{
                    "scroll-ms": m()
                }],
                "scroll-me": [{
                    "scroll-me": m()
                }],
                "scroll-mbs": [{
                    "scroll-mbs": m()
                }],
                "scroll-mbe": [{
                    "scroll-mbe": m()
                }],
                "scroll-mt": [{
                    "scroll-mt": m()
                }],
                "scroll-mr": [{
                    "scroll-mr": m()
                }],
                "scroll-mb": [{
                    "scroll-mb": m()
                }],
                "scroll-ml": [{
                    "scroll-ml": m()
                }],
                "scroll-p": [{
                    "scroll-p": m()
                }],
                "scroll-px": [{
                    "scroll-px": m()
                }],
                "scroll-py": [{
                    "scroll-py": m()
                }],
                "scroll-ps": [{
                    "scroll-ps": m()
                }],
                "scroll-pe": [{
                    "scroll-pe": m()
                }],
                "scroll-pbs": [{
                    "scroll-pbs": m()
                }],
                "scroll-pbe": [{
                    "scroll-pbe": m()
                }],
                "scroll-pt": [{
                    "scroll-pt": m()
                }],
                "scroll-pr": [{
                    "scroll-pr": m()
                }],
                "scroll-pb": [{
                    "scroll-pb": m()
                }],
                "scroll-pl": [{
                    "scroll-pl": m()
                }],
                "snap-align": [{
                    snap: ["start", "end", "center", "align-none"]
                }],
                "snap-stop": [{
                    snap: ["normal", "always"]
                }],
                "snap-type": [{
                    snap: ["none", "x", "y", "both"]
                }],
                "snap-strictness": [{
                    snap: ["mandatory", "proximity"]
                }],
                touch: [{
                    touch: ["auto", "none", "manipulation"]
                }],
                "touch-x": [{
                    "touch-pan": ["x", "left", "right"]
                }],
                "touch-y": [{
                    "touch-pan": ["y", "up", "down"]
                }],
                "touch-pz": ["touch-pinch-zoom"],
                select: [{
                    select: ["none", "text", "all", "auto"]
                }],
                "will-change": [{
                    "will-change": ["auto", "scroll", "contents", "transform", c, a]
                }],
                fill: [{
                    fill: ["none", ...u()]
                }],
                "stroke-w": [{
                    stroke: [b, U, $, je]
                }],
                stroke: [{
                    stroke: ["none", ...u()]
                }],
                "forced-color-adjust": [{
                    "forced-color-adjust": ["auto", "none"]
                }]
            },
            conflictingClassGroups: {
                overflow: ["overflow-x", "overflow-y"],
                overscroll: ["overscroll-x", "overscroll-y"],
                inset: ["inset-x", "inset-y", "inset-bs", "inset-be", "start", "end", "top", "right", "bottom", "left"],
                "inset-x": ["right", "left"],
                "inset-y": ["top", "bottom"],
                flex: ["basis", "grow", "shrink"],
                gap: ["gap-x", "gap-y"],
                p: ["px", "py", "ps", "pe", "pbs", "pbe", "pt", "pr", "pb", "pl"],
                px: ["pr", "pl"],
                py: ["pt", "pb"],
                m: ["mx", "my", "ms", "me", "mbs", "mbe", "mt", "mr", "mb", "ml"],
                mx: ["mr", "ml"],
                my: ["mt", "mb"],
                size: ["w", "h"],
                "font-size": ["leading"],
                "fvn-normal": ["fvn-ordinal", "fvn-slashed-zero", "fvn-figure", "fvn-spacing", "fvn-fraction"],
                "fvn-ordinal": ["fvn-normal"],
                "fvn-slashed-zero": ["fvn-normal"],
                "fvn-figure": ["fvn-normal"],
                "fvn-spacing": ["fvn-normal"],
                "fvn-fraction": ["fvn-normal"],
                "line-clamp": ["display", "overflow"],
                rounded: ["rounded-s", "rounded-e", "rounded-t", "rounded-r", "rounded-b", "rounded-l", "rounded-ss", "rounded-se", "rounded-ee", "rounded-es", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
                "rounded-s": ["rounded-ss", "rounded-es"],
                "rounded-e": ["rounded-se", "rounded-ee"],
                "rounded-t": ["rounded-tl", "rounded-tr"],
                "rounded-r": ["rounded-tr", "rounded-br"],
                "rounded-b": ["rounded-br", "rounded-bl"],
                "rounded-l": ["rounded-tl", "rounded-bl"],
                "border-spacing": ["border-spacing-x", "border-spacing-y"],
                "border-w": ["border-w-x", "border-w-y", "border-w-s", "border-w-e", "border-w-bs", "border-w-be", "border-w-t", "border-w-r", "border-w-b", "border-w-l"],
                "border-w-x": ["border-w-r", "border-w-l"],
                "border-w-y": ["border-w-t", "border-w-b"],
                "border-color": ["border-color-x", "border-color-y", "border-color-s", "border-color-e", "border-color-bs", "border-color-be", "border-color-t", "border-color-r", "border-color-b", "border-color-l"],
                "border-color-x": ["border-color-r", "border-color-l"],
                "border-color-y": ["border-color-t", "border-color-b"],
                translate: ["translate-x", "translate-y", "translate-none"],
                "translate-none": ["translate", "translate-x", "translate-y", "translate-z"],
                "scroll-m": ["scroll-mx", "scroll-my", "scroll-ms", "scroll-me", "scroll-mbs", "scroll-mbe", "scroll-mt", "scroll-mr", "scroll-mb", "scroll-ml"],
                "scroll-mx": ["scroll-mr", "scroll-ml"],
                "scroll-my": ["scroll-mt", "scroll-mb"],
                "scroll-p": ["scroll-px", "scroll-py", "scroll-ps", "scroll-pe", "scroll-pbs", "scroll-pbe", "scroll-pt", "scroll-pr", "scroll-pb", "scroll-pl"],
                "scroll-px": ["scroll-pr", "scroll-pl"],
                "scroll-py": ["scroll-pt", "scroll-pb"],
                touch: ["touch-x", "touch-y", "touch-pz"],
                "touch-x": ["touch"],
                "touch-y": ["touch"],
                "touch-pz": ["touch"]
            },
            conflictingClassGroupModifiers: {
                "font-size": ["leading"]
            },
            orderSensitiveModifiers: ["*", "**", "after", "backdrop", "before", "details-content", "file", "first-letter", "first-line", "marker", "placeholder", "selection"]
        }
    },
    Qo = Po(Xo),
    Te = e => typeof e == "boolean" ? `${e}` : e === 0 ? "0" : e,
    Ne = io,
    Zo = (e, o) => r => {
        var t;
        if (o ?.variants == null) return Ne(e, r ?.class, r ?.className);
        const {
            variants: n,
            defaultVariants: i
        } = o, s = Object.keys(n).map(f => {
            const p = r ?.[f],
                g = i ?.[f];
            if (p === null) return null;
            const w = Te(p) || Te(g);
            return n[f][w]
        }), d = r && Object.entries(r).reduce((f, p) => {
            let [g, w] = p;
            return w === void 0 || (f[g] = w), f
        }, {}), l = o == null || (t = o.compoundVariants) === null || t === void 0 ? void 0 : t.reduce((f, p) => {
            let {
                class: g,
                className: w,
                ...S
            } = p;
            return Object.entries(S).every(O => {
                let [A, k] = O;
                return Array.isArray(k) ? k.includes({ ...i,
                    ...d
                }[A]) : { ...i,
                    ...d
                }[A] === k
            }) ? [...f, g, w] : f
        }, []);
        return Ne(e, s, l, r ?.class, r ?.className)
    };
export {
    io as a, Zo as b, Jo as c, Qo as t
};