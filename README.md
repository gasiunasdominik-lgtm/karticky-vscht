# Studium VŠCHT

Plán semestru a opakovací kartičky ze studijních listů (ZS 2026/27) v jedné appce: **Dnes** (co je teď podle režimu, kartičky, úkoly týdne, listy k zopakování, nejbližší termíny), **Týden** (checklist po skupinách), **Kartičky**, **Předměty** (kalendář testů, podmínky zápočtu, materiály, odkazy, otázky), **Víc** (úkoly, tahák, sync, nastavení). Je to PWA: instaluje se na plochu iPhonu a funguje offline. Pokrok i odškrtání se synchronizují přes Google Sheet na tvém Drive (stejně jako Trénink deník).

- **Plánování:** FSRS-4.5, cílová úspěšnost 90 %, strop 1 rok. Před testem se interval zkrátí, aby karta přišla nejpozději den předem.
- **Odemykání:** karty se odemykají podle týdne výuky (`w` v `cards.json`). Doplňky se otevřou 3 týdny před zkouškou.
- **Pořadí:** opakování nejdřív z předmětu s nejbližším testem; nové podle týdne výuky.
- **Claude:** u kartičky „Vysvětli proč“ a „Zkontrolovat odpověď“ otevřou claude.ai s připraveným dotazem.

## Struktura

```
index.html, manifest.webmanifest, sw.js   PWA shell (offline cache – při změně souborů zvyš VERSION v sw.js)
css/app.css                               vzhled
js/app.js                                 celá appka (FSRS, sekce, sync)
cards.json                                kartičky – generuje _claude_pracovni/build_study.py ze studijních listů
semestr.json                              plán semestru – generuje _claude_pracovni/semestr_export.py z dashboardu semestr.html
apps-script/Code.gs                       backend nad Sheetem
tools/make_icons.py                       generátor ikony (py tools/make_icons.py)
```

Aktualizace dat z disku: `python3 _claude_pracovni/karticky_deploy.py` (vyexportuje a zkopíruje `cards.json` + `semestr.json`, zvýší verzi service workeru, commit + push).

## 1. Google Sheet + Apps Script (jednorázově, ~5 min)

1. Na [sheets.new](https://sheets.new) založ prázdnou tabulku, pojmenuj ji třeba *Studium VŠCHT*.
2. V tabulce otevři **Rozšíření → Apps Script**. Smaž obsah `Kód.gs`, vlož celý soubor `apps-script/Code.gs` a ulož (Ctrl+S).
3. Nahoře vyber funkci **setup** a klikni na **Spustit**.
   - Google si řekne o oprávnění: **Zkontrolovat oprávnění** → účet → **Rozšířené → Přejít na … (nebezpečné)** → **Povolit**. Je to tvůj vlastní skript.
   - V **Protokolu provádění** se objeví `TOKEN: …`. Zkopíruj si ho.
4. **Nasadit → Nové nasazení → ozubené kolečko → Webová aplikace**:
   - *Spustit jako:* **Já**
   - *Kdo má přístup:* **Kdokoli** (data chrání token).
5. **Nasadit** a zkopíruj **URL webové aplikace** (končí na `/exec`).
6. V appce **Víc → Synchronizace** vlož URL a token a dej **Uložit a otestovat**. Totéž udělej v mobilu i v PC.

## 2. Hosting

GitHub Pages z větve `main`, složka `/ (root)`: https://gasiunasdominik-lgtm.github.io/karticky-vscht/
