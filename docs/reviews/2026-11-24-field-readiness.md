# Saha testi hazırlık raporu (tester, 2026-11-24, T193 son koşu)

Ağaç: `main` @ `751b649` (B63, B64, B60 içinde). Saha: Mach3, elle takım değişimi, MDF 18.

## Özet

**Karar: HAZIR (yazılım tarafı).** Blocker yok. Tek kalan kapı sahibin imzası ve makine bilgisinin
toplanması (sahibin satırları, bu raporda işaretlenmedi).

- CTO #13 MUST M1 (tutan köprü) ve M2 (genişletilmiş test parçası köprülü) ana dalda ve çıkan NC
  dosyalarında doğrulandı.
- B63 (program sonu park noktasında, "vakum elle" satırı, PDF) doğrulandı.
- Prova işleri, kit dosyaları ve bağımsız kontrol: 0 ihlal.
- Runbook (`docs/machines/saha-gunu.md`) iki yerde artık yanlış: adım 6 (pay 8 / kenar 16) ve bölüm D
  ("köprüsüz"). Zararsız ama yanıltıcı; sahibe gitmeden düzeltilmeli (aşağıda).

### Sahada önemli bilinen sorunlar

1. **Runbook "Gitmeden 6" eski.** Uygulama köprü açıkken payı kendisi takım Ø + 3,1 mm'ye (Ø8: 19,1 mm
   açık mesafe), kenar payını Ø + 3 mm'ye (11 mm) yükseltiyor ve Dizilim'de bunu yazıyor. 8 / 16 girmek
   zorunlu değil (8 zaten 11,1'e yükselir, 16 > 11 aynen kalır). Zarar yok; sebep metni yanlış.
2. **Runbook bölüm D eski.** `TESTPARCA_GENIS_S1.tap` artık köprülü ("kopru her parcada 4 adet"),
   dış kontur 4 köprü. "Köprüsüz keser, atlayın" cümlesi geçersiz.
3. **Köprü sayısı başlıkta bazen iyimser (SHOULD, güvenlik değil).** Karma iş C'de (aşağıda) bağımsız
   modelim 2 küçük parçanın (Takoz) bir köprüsünün arkasındaki 3 mm'nin komşunun lead dalışı
   (X2699,4 Y141,2 ve Y210,3, yarıçap 4) tarafından alındığını buldu; başlık "KOPRU AZ: 2 parçada 3
   köprü" diyor, gerçekte 4 Takoz'un hepsi 3 tutan köprüde. Her parça ≥ 3 tutan köprü, küçük parça
   kuralı ≥ 2, yani güvenli. Kayıt: dev'e M1 takibi olarak.
4. **Genişletilmiş parçanın iç penceresi (80 × 50) 3 köprülü**, Uyarılar'da `TABS_REDUCED` uyarısı var,
   başlık "4 adet" diyor (dış kontur için doğru). Parça dış konturdan 4 köprüyle tutuluyor.
5. Park açıkken makine home edilmiş olmalı: uygulama bunu export listesinde ve NC başlığında yazıyor.
   Runbook zaten park'ı kapalı bırakmayı söylüyor (K3). Park kapalıyken program son parçanın üstünde
   `G0 Z20, M5, M9, M30` ile biter (tasarım gereği, N2).
6. Makineden öğrenilecekler (kod değil, sahibin listesi): G04 birimi, M7 çıkışı, home, eksen yönleri,
   devir kontrolü, gerçek ilerleme tavanı, Demo sürüm (500 satır; karma iş C 511 satır).

## 1. Süit

| Kontrol | Sonuç |
| --- | --- |
| CI koşusu 45340824739 (`integration/38`, kafa `78dc7f2`, ağaç `751b649` ile aynı: `git diff` boş) | success: db, lint-typecheck-test-build-licences, e2e chromium 5/5 shard, visual-axe: hepsi success; golden-file guard: skipped (golden değişikliği yok) |
| Yerelde `pnpm test` (bu ağaçta, bir kez) | yeşil: ui 238, core 4301 (222 dosya), db 174 (1 atlandı), web 780 (1 expected-fail), script testleri 27 pass / 0 fail |

e2e tam süit yeniden koşulmadı (görev gereği); CI özeti yukarıda.

## 2. Saha provası (main @ 751b649)

Yöntem: üretim derlemesi + Playwright (1 işçi), UI'dan iş kurulumu, NC indirme, bağımsız kontrol
(`verifyDownloaded`) ve repodan bağımsız yazdığım satır satır lint + köprü tutma modeli. Makine:
seed makineden kopyalanmış, post `mach3`, elle takım değişimi, MDF 18, plaka 2800 × 2070. Park: X50 Y2100
(açık) ve kapalı varyantlar; ayrıca vakum kodları boş varyant. Tarama betikleri commit edilmedi.

| İş | Makine | Sonuç |
| --- | --- | --- |
| A Dolap (varsayılan, 6 kontur) | park açık | 1 plaka, 396 satır, kontrol 6/6 ihlal 0, 24/24 köprü tutuyor (önce 10/24) |
| B Kapak + menteşe Ø35 + kulp 128 (T1 Ø6, T2 Ø8) | park açık | 245 satır, 3/3, ihlal 0, 2 × M0 (ilk takım T1, sonra T2 değişimi), 4/4 köprü |
| C Karma: Yan ×2, Raf ×2, Takoz 80 × 50 ×4 | park açık ve park kapalı | 511 / 505 satır, 8/8, ihlal 0; başlık "KOPRU AZ: 2 parcada 3 kopru" (bkz. bilinen sorun 3) |
| V Yan ×2 + Takoz ×4, vakum kodları boş | park açık | ihlal 0; "VAKUM PROGRAMDAN ACILMIYOR: KESIMDEN ONCE ELLE ACIN" başlıkta, export listesinde satır var; dosyada M7 / M9 yok |
| Kit: AIRCUT, AIRCUT_GENIS, TESTPARCA, TESTPARCA_GENIS | park açık | indirilebilir (kontrol geçti); air cut'lar Z ≥ +20, hiç kesme yok |

### M1: köprü tutuyor mu

- Parçalar arası: Takoz sütununda 69,1 mm adım = 50 + **19,1** mm açık (Ø8 + 11,1); kenar payı **11** mm
  (Ø + 3). Dizilim notu: "Parça arası boşluk: takım Ø8 + pay 11,1 = 19,1 mm", "Köprü açıkken ... en az
  takım Ø + 3 mm (11,1 mm) ... kenar payı ... (11 mm) kullanılır."
- Dolap A: bağımsız modelde 6 / 6 kontur, 24 / 24 köprü tutuyor. Kapak B: 4 / 4. Genişletilmiş parça: dış 4 / 4,
  pencere 3 / 3. 200 × 200 parça: 4 / 4.
- "KOPRU AZ" başlığı yalnızca C'de ve V'de çıktı (Takoz'lu işler); A, B, kit dosyalarında yok. Gerçek durum
  ile farkı bilinen sorun 3'te.
- Kenar: en küçük kesim merkezi X7 (kesici kenarı X3 ≥ 0): kesici plakada kalıyor (B2 kapalı).

### M2: genişletilmiş test parçası

`TESTPARCA_GENIS_S1.tap`: başlık "KESIM: kopru her parcada 4 adet 10 × 3 mm"; son geçiş dört köprü
(Z-15, 18 mm'lik hareket), hepsi düz kenarda, R20 yaylarda yok; sonda park, `M9`, `M30`. Kit metni:
"Parça dış konturda 4 köprüyle plakaya bağlı kalır (yay köşelerde köprü yok)". `AIRCUT_GENIS` aynı hareketler, hepsi Z ≥ 20.

### NC okuma listesi (gcode-safety), tüm dosyalar

- İlk kod satırı `G21 G90 G91.1 G17 G40 G49 G54`; sadece yorumlar öncesinde. ✔
- İlk hareket `G0 Z20` (XY yok); `M3 S18000` sonra `G4 P5.0`, ilk besleme hareketi dwell'den sonra. ✔
- Güvenli Z altında XY rapid: 0. `G0` ile Z < 0: 0. `F0`: 0. Kesim sırasında spindle kapalı: 0. ✔
- En derin Z −18,5 (18 + 0,5 fire tabla). Yay yarıçap hatası ≤ 2,3e-13 mm. ✔
- Takım değişimi: `G0 Z20`, `M5`, park (`G53 G0 X50 Y2100`), mesaj "TAKIM DEGISTIR: T2 D8.000 - Z SIFIRLA ...",
  `M0`, `G0 Z20`, `M3`, `G4`. Hepsinde **M0**, hiçbir yerde M1. ✔
- Program sonu (park açık): `G0 Z20`, `M5`, `G53` park, `M9` (varsa), `M30`. M5 ve güvenli Z, M9/M30'dan önce. ✔
- Park kapalı: `G0 Z20`, `M5`, `M9`, `M30`. ✔
- G53 yalnızca park noktasında (kontrol `MACHINE_MOVE`), güvenli Z'de, spindle kapalıyken. ✔
- Başlık: `DOGRULANMADI, once air cut` ilk satır; şablonlu işte `SABLON DOGRULANMADI`. ✔
- Bağımsız kontrol 0 ihlal, kesilen parça = beklenen (A 6/6, B 3/3, C 8/8 ×2, V).

## 3. Runbook gerçeği (`docs/machines/saha-gunu.md`)

Uyanlar: kit dosya adları (`AIRCUT_S1`, `AIRCUT_GENIS_S1`, `TESTPARCA_S1`, `TESTPARCA_GENIS_S1`); ilk M0
metni "TAKIM T2 D8.000 TAKILI MI?"; takım değişimi metni; başlık satırları `PLAKA 1/1`, `TAKIMLAR: T1 D6.000,
T2 D8.000`, `KESIM: kopru her parcada 4 adet`; yan 559 × 720; vakum boş bırakma (başlık ve export satırı var);
Mach3 ön kontrol maddeleri (G04, M7, M3, Demo, Spindle, Homing, Motor Tuning, M30); park kapalı uyarısı;
kıskaç 30 mm bandı ve 20 mm sınırı; air cut Z sıfırı (kit artık "fedakâr tabla" diyor, runbook ile uyumlu);
"Her parçada" köprü etiketi; 21,5 mm havada geçiş hesabı (Z −18,5 − 40 mm takoz).

Uymayanlar:

| # | Runbook | Uygulama şimdi | Öneri |
| --- | --- | --- | --- |
| 1 | Gitmeden 6: pay 8, kenar 16 yap; sebep "0,1 ile 10 / 24 köprü boşa gider" | otomatik Ø + 3,1 / Ø + 3 (D-129); not Dizilim'de; 24 / 24 tutuyor | adımı "değiştirmeyin; Dizilim'deki notu görün (19,1 / 11 mm)" yap, F1 cümlesini sil |
| 2 | D: genişletilmiş parça köprüsüz, atla | köprülü, başlıkta `kopru her parcada` | bölümü "köprülü; atlamadan çalıştırın" yap |
| 3 | E.1 yalnız `KESIM` satırı | başlıkta `KOPRU AZ: ...` satırı ve export'ta "köprü" satırı çıkabilir | bir cümle ekle: çıkarsa sayıyı okuyun; her parçada ≥ 2 köprü kalır |
| 4 | Giriş cümlesi "CTO #13 ... F1/F2 (dosya D)" kaynakları | M1 / M2 inmiş durumda | kaynak notunu güncelle |

Park kapalı kalacağı için sahada park satırları devrede değil; park açık dosyalar yine de okundu ve temiz.

## 4. Rapor dışı notlar

- Prova işleri B ve C'de `TAKIMLAR` ve M0 sayıları beklenen. Prova #1 B1/B2 bulguları (besleme tavanı, lead
  kenarı) bu ağaçta kapalı: besleme 59 000 reddediliyor (T330, CI'da yeşil), kesici kenarı plakada.
- Bu PR yalnızca bu rapor + BACKLOG satırlarıdır; uygulama kodu ve runbook değişmedi.
