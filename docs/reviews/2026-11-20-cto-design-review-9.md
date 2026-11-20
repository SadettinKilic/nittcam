# CTO tasarım incelemesi #9 (2026-11-20)

Kapsam: main `e0c0273` (B20a, B21 / B21b, T284, B23, B24, B25, T170, T171 sonrası; M5–M7 kapandı). Önceki inceleme: `2026-11-20-cto-design-review-8.md`.

Yöntem: #8 ile aynı kurulum (üretim derlemesi, boş PGlite, port 3210). Playwright ile 1440 × 900 açık / koyu, üç gezinti ve bir 3D montaj kontrolü. 10 görüntü `2026-11-20-cto-9/` klasöründe. Sahibinin token kuralı gereği kısa inceleme (D-042): 1024 ve telefon ölçülmedi, spec yeniden okunmadı, e2e paketi çalıştırılmadı. Ürün koduna, BACKLOG'a ve DECISIONS'a dokunulmadı.

Uygulanan kurallar: **D-047** (en çok 3 "şimdi düzelt", gerisi cila kuyruğu), D-045 (operatör gezintisi), D-043 (önce masaüstü).

Sınırlar: tıklar betikte gerçek olay sayımıdır (`isTrusted` tıklar); dosya seçimi betikte tıksız yapıldığı için #8 ile karşılaştırmada elle eklendi. İnceleme ekstraları (45° yeniden diz, 3D aç / kapat) gezinti sayısından düşüldü. Konsol hatası görülmedi.

## Puanlar

| Başlık | #3 | #4 | #5 | #6 | #7 | #8 | #9 | Not |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 7 | 7,5 | 7,5 | 7,5 | 7,5 | 7,5 | **8** | Proje ve dosya adları artık doğru (3 / 3 gezinti); "Doğrulanacak" rozeti panelde. Tutan: adım değişince kalan bildirim, montaj kamerasında dolabın altı kırpık |
| Modernlik | 8 | 8 | 8 | 8 | 8 | 8,5 | **9** | Montaj görünümü (menteşe yuvalarıyla), Dizilim'de delikler ve açıklama, gerçek şekil 45° / 15°, iç boşluğa yerleştirme, artık parça önerisi |
| Kullanılabilirlik | 7,5 | 7,5 | 8 | 8 | 8 | 8,5 | **8,5** | Gezinti sayıları aynı ya da iyi. Tutan: panelden "Yerleştir" kulpu menteşeyle aynı kenara koyuyor (A), Ayarlar panelinde seçenekler uzadı, iç boşluk / gerçek şekil hiçbir şey kazandırmadığında geri bildirim yok |
| M4–M7 için hazır olma | 7,5 | 8 | 8 | 8,5 | 8,5 | 9 | **9** | #8'in A (doğrulanmamış şablon her adımda ve dosyada) ve B (proje adı, T283) kapandı. Dosyalar kurallı, kontroller geçti |

Özet: #8'in iki "şimdi düzelt" bulgusu tam kapandı ve doğru yerde: kontrol listesinde ayrı onay, Simülasyon özetinde satır, panelde rozet, G-code başlığında `(SABLON DOGRULANMADI: ...)`. M7 eklemeleri (montaj, gerçek şekil, artık parça) gezinti sayısını artırmadan geldi. Bu turdan tek "şimdi" bulgusu çıktı (A).

## Gezinti 1: mutfak alt dolabı (D-045, tekrar)

| Ölçü | #6 | #7 | #8 | #9 |
| --- | --- | --- | --- | --- |
| Tık | 16 | 16 | 16 | **16** (betikte 17: Diz düğmesine ayrıca basıldı) |
| Yazılan değer | 5 | 5 | 5 | **5** |
| Çıktı | 12,5 KB | 12,2 KB, 511 satır | `Adsiz_projeMutfak_alt_dol_S1.tap` | **`Mutfak_alt_dolap_60_S1.tap`**, 12,2 KB, 511 satır, kontroller geçti, ≈ 13 dk 2 sn, 32 köprü |

- **T283 doğrulandı**: ada tıklayıp yazmak varsayılanın yerine geçiyor; başlık `(PROJE: Mutfak alt dolap 60)`, dosya adı doğru. #8'in B bulgusu kapandı.
- Gerileme yok (`cutlist-cabinet-1440-light.png`).

## Gezinti 2: menteşeli kapak, 4 kenar bant + hazır şablon → diz (gerçek şekil kapalı / açık) → NC

İş: Kapak 596 × 716, damarlı, 4 kenar 1 mm bant (Excel'den yapıştır); Çizim'de kapak seçilir, "Menteşe çukuru Ø35 (2 menteşe)" ve "Kulp deliği 128 mm" panelden "Yerleştir" ile eklenir; diz, 45° ile yeniden diz, simüle et, NC.

| Ölçü | #8 (tahtada çizim + hayalet) | #9 (yapıştır + panelden Yerleştir) |
| --- | --- | --- |
| Tık | 26 | **24** (inceleme ekstraları hariç; ham 29) |
| Yazılan değer | 3 | **2** (proje adı, yapıştırılan satır) |
| Çıktı | `Adsiz_projeMenteseli_kapa_S1.tap`, 235 satır | `Menteseli_kapak_60_S1.tap`, 6,8 KB, 236 satır, kontroller geçti, T1 → T2, ≈ 2 dk 35 sn |

Gözlemler:

1. **#8 A kapandı** (`export-door-1440-light.png`, `sim-door-1440-light.png`, `board-door-1440-dark.png`): Dışa aktar'da 6. onay "Hazır şablon ölçüleri doğrulanmadı: Menteşe çukuru Ø35 (2 menteşe), Kulp deliği 128 mm…"; Simülasyon özetinde aynı satır; panelde sarı "Doğrulanacak" rozeti; dosyanın 2. satırı `(SABLON DOGRULANMADI: Mentese cukuru D35 2 mentese, Kulp deligi 128 mm)`. Kalıp tutarlı.
2. **Kulp menteşe kenarına düştü** (`board-door-1440-dark.png`, `layout-door-1440-light.png`): hayalet kullanılmadan panelden "Yerleştir" basılınca iki şablon da "Sol" kenara gidiyor; kulp delikleri X 30 (menteşe yuvaları X 22,5). Kontroller geçti, dosya indi. Gerçek kapakta kulp menteşe tarafında olamaz; kapak çöpe gider. **Şimdi düzelt A.**
3. **Bant**: dört kenarda 1 mm bant listede ve kesim listesinde görünüyor; "Bitmiş ölçü" kapalıyken ölçü kesim ölçüsü. Bant hücreleri birimsiz "1" yazıyor (cila).
4. **Gerçek şekil 45°**: dikdörtgen kapakta sonuç aynı (fire %92,6), bu beklenen. Ama kullanıcıya "gerçek şekil bu işte kazanç sağlamadı" denmiyor; yavaş seçeneğin bir şey yapıp yapmadığı görünmüyor (cila, #8'deki mod kartı maddesiyle birleşir).
5. **Dizilim'de delikler artık çiziliyor** (T171): yuvalar ve kulp delikleri parçanın üstünde; #8 cila maddesi kapandı. Delikler küçük ölçekte nokta kadar; yakınlaşınca okunuyor.
6. **Artık parça önerisi** iki dikdörtgeni önceden işaretli getiriyor (2.186 × 2.070, 614 × 1.336) ve "Stoğa kaydet (2)" düğmesi var. İyi; ön işaretli gelmesi tartışılabilir (cila değil, not).

## 3D montaj ve delikler (B21 / B24)

- `assembly-3d-1440-light.png`: varsayılan dolap + kapakta hazır menteşe şablonu; Dizilim → 3D → "Montaj görünümü". `data-assembly = Dolap 1:600x720x578`, `data-assembly-features = 1`: kapak gerçek geometriyle, **menteşe yuvaları görünüyor** (kapağın sol kenarında iki halka). Raflar ve arkalık doğru yerde.
- Cila: kamera dolabın altını kırpıyor (ilk görünüm montaja sığmıyor); yuvalar yarı saydam kapakta çok soluk.

## Gezinti 3: DXF tabela, iç boşluğa yerleştirme açık

| Ölçü | #8 | #9 |
| --- | --- | --- |
| Tık | 15 | **16** (+1 "Küçük parçaları iç boşluklara yerleştir") |
| Yazılan değer | 1 | **1** |
| Çıktı | `Adsiz_projeTabela_harfler_S1.tap`, 263 satır | `Tabela_harfler_S1.tap`, 7,0 KB, 263 satır, kontroller geçti, ≈ 2 dk 11 sn, 16 köprü |

- `layout-sign-inhole-1440-dark.png`: 3 harf köşede; O'nun iç boşluğuna sığacak parça yok, sonuç anahtarsızla aynı. Kullanıcıya "iç boşluğa 0 parça yerleşti" gibi bir geri bildirim yok (cila).
- Harfler 2.800 × 2.070 plakada çok küçük, etiketler harflerin üstüne biniyor; "işe sığdır" hâlâ yok (#8 cilası, açık).
- "sign-letters.dxf: 3 parça eklendi · Geri al" bildirimi 3. adımda hâlâ duruyor ve sağ alttaki ölçek çubuğunu örtüyor (#8 cilası, açık; gezinti 2'de "1 satır eklendi" de Çizim ve Dizilim'de kaldı).

## İyi olanlar (koruyun)

- #8'in iki bulgusu eksiksiz ve aynı kalıpla kapandı (onay, özet, rozet, dosya yorumu).
- M7 eklemeleri gezinti sayısını artırmadı; seçenekler varsayılan kapalı ve açıklamalı.
- Montaj görünümü tek düğme ve gerçek geometri; Dizilim'de delikler.
- Dosya başlığı okunur ve dürüst: profil, post, şablon doğrulanmadı satırları.

## Şimdi düzelt (D-047: en çok 3; bu tur 1)

Numarayı PO verir.

### A. Kulp şablonu menteşe şablonuyla aynı kenara sessizce yerleşmesin

Neden "şimdi": yanlış çıktı. Panelden "Yerleştir" (hayaletsiz yol) her şablonu varsayılan "Sol" kenara koyuyor; menteşeli kapağa kulp eklenince kulp delikleri menteşe tarafına delinir, kontroller geçer, dosya iner. Kapak çöpe gider.

Spec: §4.7, §7.2 · Depends: T148, T150 · Decision: D-045

Acceptance:
- [ ] parçada menteşe türü bir şablon örneği varken kulp türü şablon panelden "Yerleştir" ile eklenirse varsayılan kenar menteşenin karşı kenarıdır (sol ↔ sağ, üst ↔ alt); hayaletle yerleştirmede kullanıcının seçtiği kenar değişmez
- [ ] kullanıcı kulpu menteşeyle aynı kenara elle koyarsa kesim listesi / parça sorunlarında bir uyarı çıkar: "Kulp delikleri menteşe ile aynı kenarda (Kapak)"; uyarı engellemez, Dışa aktar kontrol özetinde görünür
- [ ] şablon türü (menteşe / kulp) hazır kütüphane verisinden okunur; şirket şablonunda tür yoksa davranış bugünkü gibidir
- [ ] golden G-code dosyaları değişmez
- [ ] yarım günü aşarsa en küçük çözüm: ilk madde (karşı kenar varsayılanı); uyarı ayrı görev

Tester focus: hazır menteşe + hazır kulp panelden (kulp sağda), hayaletle sola (uyarı var, indirme açık), menteşesiz parçaya kulp (bugünkü gibi), aynala; 1440 açık / koyu; axe.

## Cila kuyruğu (D-047)

PO'nun `docs/BACKLOG.md` "Polish queue (M9; D-047)" bölümüne eklemesi için:

- Bildirim: "1 satır eklendi" / "dosya.dxf: 3 parça eklendi" adım değişince kapanmıyor, panel ve ölçek çubuğunu örtüyor (#8 maddesi; hâlâ açık, iki gezintide görüldü)
- Montaj 3D: ilk kamera montaja sığmıyor (dolabın altı kırpık); menteşe yuvaları yarı saydam kapakta çok soluk (`assembly-3d-1440-light.png`)
- Dizilim: gerçek şekil (45° / 15°) ve iç boşluk seçenekleri sonuç değiştirmediğinde geri bildirim yok ("iç boşluğa 0 parça", "45° kazanç yok"); mod kartı maddesiyle birleştir
- Dizilim / Simülasyon: küçük işte "işe sığdır" yok, harf etiketleri parçanın üstüne biniyor (#8 maddesi, açık) (`layout-sign-inhole-1440-dark.png`)
- Dizilim Ayarlar paneli: döndürme, iç boşluk, artık parça seçenekleriyle uzadı; "Diz" düğmesi seçenekler açılınca aşağı kayıyor; panel kaydırılınca üstte yarım satır kesik görünüyor
- Kesim listesi: bant hücreleri birimsiz ("1"); "1 mm" ya da başlıkta "(mm)"
- Artık parça önerisi: öneriler önceden işaretli; tek tıkla stoğa gidiyor, varsayılanın bilinçli olduğu bir kez düşünülsün

#8 kuyruğundan bu turda kapanmış görülenler: Dizilim'de delikler (T171), proje adı (T283, "şimdi" listesindeydi). Hâlâ açık: kalan bildirim, işe sığdır, uzun özellikler paneli (bu turda ölçülmedi), mod kartları.

## Karar verildi (sahibi isterse değiştirir)

- **K1 (D-045 ölçüsü):** dolap **16 / 5** (aynı); menteşeli kapak hazır şablonla, yapıştırma yolu **24 / 2** (yeni satır; çizim yolu #8'deki 26 / 3 kalır); DXF tabela **15 / 1**, iç boşluk açıkken 16 / 1.
- **K2:** hazır şablonun varsayılan yerleşimi, aynı parçadaki diğer şablonlarla çelişen bir delik deseni üretmemeli (A'nın genel kuralı).

## Çıktılar

- `docs/reviews/2026-11-20-cto-design-review-9.md` ve `docs/reviews/2026-11-20-cto-9/` (10 görüntü, 1440 × 900).
- `docs/BACKLOG.md` ve `docs/DECISIONS.md`: değişmedi (triyaj PO'da).

| Ekran | Dosyalar |
| --- | --- |
| Kesim listesi | `cutlist-cabinet-1440-light.png`, `cutlist-door-band-1440-light.png` |
| Çizim tahtası | `board-door-1440-dark.png` |
| Dizilim | `layout-door-1440-light.png`, `layout-door-3d-1440-dark.png`, `layout-sign-inhole-1440-dark.png`, `assembly-3d-1440-light.png` |
| Simülasyon | `sim-door-1440-light.png`, `sim-sign-1440-light.png` |
| Dışa aktar | `export-door-1440-light.png` |
