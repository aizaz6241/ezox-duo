# EZOX Duo — sirf hum dono ka private room

**Live:** https://ezox-duo.onrender.com (Render, Singapore server — GitHub par push karte hi khud update hota hai)

Aap dono ke liye apna app: **video call + voice + chat + movie saath dekhna**.
Room mein sirf **2 log** aa sakte hain, password ke saath. Koi chat ya call save nahi hoti.

## Kya kya chalta hai
| Cheez | Kaise |
|---|---|
| Video call / voice call | Camera aur mic — 📷 aur 🎤 button se on/off. 🔄 se mobile ka camera badlo |
| Messages | Right side chat box ("likh rahe hain…" bhi dikhta hai) |
| YouTube | Link paste karo → **Chalao**. Dono ka play/pause/seek ek saath |
| Koi bhi .mp4 link | Link paste karo → **Chalao** |
| Apni movie file | **Apni file** → dono apne device se *wohi* file chunein → sync |
| Netflix | Chrome extension ke zariye (neeche dekho) |
| Netflix dekhte hue call | 🪟 button → partner ki video chhoti window mein upar tair rahi hogi |

## 1) Apne computer par chalao (test)
```bash
npm install
npm start
```
Browser mein `http://localhost:3000` kholo. Do alag tab mein same room/password se join karke test karo.

## 2) Internet par daalo (taake Hira apne phone se aa sake) — free
Camera sirf **https** link par chalta hai, is liye online daalna zaroori hai.

1. Yeh folder GitHub par push karo.
2. [render.com](https://render.com) → **New → Web Service** → apna repo chuno.
3. Build command: `npm install` · Start command: `npm start` · Plan: Free.
4. Link milega jaise `https://ezox-duo.onrender.com` — yehi dono kholo.

Note: Render ka free plan 15 minute khali rehne ke baad so jata hai; pehli dafa kholne mein ~30 second lagte hain.

## Phone par app ki tarah install karna (App Store ki zaroorat nahi)
- **iPhone:** Safari mein link kholo → neeche **Share** (⬆️) → **Add to Home Screen** → Add. Ab "Duo" ka icon aa jayega.
- **Android:** Chrome mein link kholo → upar ⋮ → **Add to Home screen / Install app**.
- **Laptop:** Chrome mein link kholo → address bar mein install ka icon → Install. (Netflix sync ke liye laptop par extension bhi lagao.)

## Phone par Netflix / Prime / Hotstar (iPhone + Android)
Phone par koi app doosri app ka play button nahi daba sakti (Apple aur Google ijazat nahi dete — Rave bhi nahi). Is liye **Ready check** hai, jaise game mein dono "Ready" dabate hain:
1. Duo mein **🎬 Netflix / Prime** dabao → **📱 Phone par**.
2. Dono apni Netflix/Prime app mein same movie kholo.
3. Ek banda time likhe (jaise `0:00` ya `45:10`) — partner ki screen par bhi "Dono movie ko 45:10 par rok do" aa jayega.
4. Dono movie ko us time par rok kar **✅ Main ready hoon** dabao.
5. Dono ready hote hi server **dono ko ek hi waqt** 3-2-1 bhejta hai → **PLAY** par dono play daba do.
6. Beech mein rokna ho to **⏸ Dono pause** — partner ke phone par bara laal alert + vibrate.

Tip: Netflix app ko split-screen / picture-in-picture mein rakho aur Duo ki call saath chalao. Agar ek hi Netflix account dono use karo to plan mein 2 screens honi chahiye.

## 3) Mobile data par call na lage to (TURN server)
Ghar ke WiFi par aksar seedha chal jata hai. Lekin Jazz/Zong/Telenor data par kabhi kabhi call connect nahi hoti, kyunke mobile company beech mein deewar rakhti hai. Iska hal **TURN server** hai — yeh beech ka "dakiya" hai jo video aage pohanchata hai.

1. [metered.ca/stun-turn](https://www.metered.ca/stun-turn) par free account (har mahine free limit milti hai).
2. Wahan se URL, username, password lo.
3. Render → apni service → **Environment** mein yeh daalo:
   - `TURN_URL` = `turn:xxx.relay.metered.ca:80,turn:xxx.relay.metered.ca:443?transport=tcp`
   - `TURN_USER` = username
   - `TURN_PASS` = password

## 4) Laptop par — Netflix, Prime Video, Hotstar, YouTube (khud sync)
Laptop par extension sab kuch khud karta hai: play, pause, aage-peeche.
1. Chrome mein `chrome://extensions` → upar right **Developer mode** ON.
2. **Load unpacked** → is project ka `extension` folder chuno.
3. Extension icon par click → Server link (Render wala), naam, **same room aur password** → Save.
4. Site par same movie kholo. Upar "EZOX Duo · Netflix connected ✓" aayega.
5. Jo bhi play/pause/aage karega, doosre ka bhi hoga.
   - Netflix aur YouTube par partner doosri movie par ho to extension khud wohi khol deta hai.
   - Prime / Hotstar par message aata hai "same wali kholo".
6. Ek waqt mein sirf **ek** movie tab khula rakho.
7. Call ke liye Duo wala tab bhi khula rakho aur 🪟 dabao.

Ek dost laptop par ho aur doosra phone par? Tab dono **Phone wala Ready check** use karo.

Note: yeh sites apna player kabhi kabhi badalti hain. Agar kabhi seek sync na ho to play/pause phir bhi chalega — batana, fix kar denge.

## Files
```
server.js            → room, password, 2 log ki limit, messages aage bhejna
public/index.html    → app ka design
public/app.js        → video call (WebRTC), chat, video sync
public/style.css     → dark theme, mobile friendly
extension/           → Netflix / Prime / Hotstar / YouTube sync (Chrome)
```
