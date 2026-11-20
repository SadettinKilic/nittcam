# CTO tasarım incelemesi #8 (2026-11-20)

Kapsam: main `eb7ebb6` (B14a, B17 + B18, B19 + B20, B22, T273, T280 sonrası; M5 çıkış akışı). Önceki inceleme: `2026-11-19-cto-design-review-7.md`.

Yöntem: uygulama üretim derlemesiyle ve boş bir PGlite veritabanıyla 3210 portunda çalıştırıldı (inceleme #7 ile aynı kurulum). Playwright ile tek tarayıcıda 1440 × 900 (açık ve koyu) gezildi: kesim listesi, çizim tahtası (hazır şablon), DXF içe aktarma, Dizilim (modlar, iki plaka boyu, 3D), Simülasyon (2D, 3D, takım yolu, oynatma), Dışa aktar, Şablonlar sayfası. 15 görüntü `2026-11-20-cto-8/` klasöründe. Ürün koduna, BACKLOG'a ve DECISIONS'a dokunulmadı; e2e paketi çalıştırılmadı.

Uygulanan kurallar: **D-047** (bulgular "şimdi düzelt" ve "cila kuyruğu"; en çok 3 görev), D-043 (önce masaüstü; bu incelemede 1024 ve telefon ölçülmedi), D-045 (operatör gezintisi), D-042 (hafif inceleme).

Sınırlar: gezintileri betik yaptı; tık ve değer sayıları gerçek, süre tahmindir. Tab ile alan geçişi ve tekerlek tık sayılmadı. Konsol hatası görülmedi. İnen üç dosya elle okundu. 1024 × 768 ve 390 × 844 bu turda ölçülmedi (token bütçesi, D-042); bir sonraki incelemede yapılmalı.

## Puanlar

| Başlık | #3 | #4 | #5 | #6 | #7 | #8 | Not |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 7 | 7,5 | 7,5 | 7,5 | 7,5 | 7,5 | Şablonlar sayfası, DXF penceresi ve 3D görünüm temiz ve aynı dilde. Puanı tutan: her projenin adı ve dosya adı "Adsız proje…" ile başlıyor (5 / 5 gezinti), Simülasyon 3D araç çubuğu 1440'ta kırpık ("…etrik"), DXF bildirimi 4. adımda G-code panelini örtüyor, şablon küçük resimlerinde Ø35 yuva Ø6 delikten küçük görünüyor |
| Modernlik | 8 | 8 | 8 | 8 | 8 | 8,5 | 3D önizleme (ayır / kaldır, fireyi gizle, görünüm küpü), takım yolu üstüne bindirme, hızlı oynatma, kenara yapışan şablon hayaleti, katman eşlemeli DXF önizlemesi. Bir CAM için güncel his |
| Kullanılabilirlik | 7,5 | 7,5 | 8 | 8 | 8 | 8,5 | Menteşeli kapak 38 tık / 27 değer → **26 / 3**; DXF tabela 15 / 1. Dolap 16 / 5 aynı. 9'u tutan: proje adı hatası, Dizilim'de delik yok, özellikler paneli 2.511 px, üç mod kartı aynı sonucu gösteriyor |
| M4–M6 için hazır olma | 7,5 | 8 | 8 | 8,5 | 8,5 | 9 | #7'nin üç bulgusu kapandı: çok takımlı kontrol listesi + Z sıfırla satırı ve yorumu, delik hataları satırda, delik tıklanan yerde. Takım sırası artık tek değişim (T1 → T2). Yaylarda köprü doğru. Tutan: doğrulanmamış hazır şablon ölçüleri dosyaya uyarısız gidiyor (A) |

Özet: M5'in uçtan uca akışı (şablon → diz → NC) çalışıyor ve dosyalar kurallı. #7'nin üç "şimdi düzelt" görevi tam kapandı. Bu incelemenin iki "şimdi" bulgusu küçük: hazır şablonun "doğrulanacak" ölçüleri yalnızca Şablonlar sayfasında söyleniyor, dosyaya ve kontrol listesine ulaşmıyor; proje adı hatası üçüncü incelemede de her işi bozuyor.

## Gezinti 1: mutfak alt dolabı (D-045, tekrar)

İş: 600 × 720 × 560 alt dolap + 2 raf, elle Baza 564 × 100, simüle et, G-code indir.

| Ölçü | #5 | #6 | #7 | #8 |
| --- | --- | --- | --- | --- |
| Tık | 17 | 16 | 16 | **16** |
| Yazılan değer | 5 | 5 | 5 | **5** |
| Ekran | 5 adım + 1 pencere | aynı | aynı | aynı |
| Betik süresi | 20,1 sn | 12,2 sn | 11,8 sn | 5,3 sn (karşılaştırılamaz) |
| Çıktı | 12,2 KB | 12,5 KB, 510 satır | 12,2 KB, 511 satır | `Adsiz_projeMutfak_alt_dol_S1.tap`, 12,2 KB, 511 satır, kontroller geçti, 1 plaka, ≈ 13 dk 2 sn |

Dağılım aynı: Yeni proje 1 · proje adı 1 · İleri 4 · Dolap ekle 3 · Satır ekle 1 · Oynat 1 · onay 4 · İndir 1. Gerileme yok (`cutlist-cabinet-1440-light.png`). Proje adı alanına tıklayınca yazılan ad hâlâ "Adsız proje"nin sonuna ekleniyor (dosya adına bakın); #7'de cilaydı, bu turda **Şimdi düzelt B**.

## Gezinti 2: menteşeli kapak, hazır şablonla → diz → NC (M5 çıkışı)

İş: 596 × 716 kapak tahtada çizilir; hazır "Menteşe çukuru Ø35 (2 menteşe)" sol kenara, hazır "Kulp deliği 128 mm" sağ kenara konur; diz, simüle et, NC indir. Delik seti #7'den farklı (4 × Ø5 yerine kütüphanedeki 2 × Ø6 kulp deliği); karşılaştırma yaklaşıktır.

| Ölçü | #7 elle (taban) | #8 hazır şablonla |
| --- | --- | --- |
| Tık | 38 | **26** |
| Yazılan değer | 27 | **3** |
| Ekran | 5 adım | 5 adım |
| Betik süresi | 14,9 sn | 11,2 sn |
| Çıktı | 8,0 KB, 285 satır, T2 → T3 → T2 | `Adsiz_projeMenteseli_kapa_S1.tap`, 6,6 KB, 235 satır, kontroller geçti, T1 → T2, ≈ 2 dk 38 sn |

Dağılım (26): Yeni proje 1 · proje adı 1 · İleri 4 · Çizim 1 · Dikdörtgen 1 · ilk köşe 1 · Seç 1 · parçayı seç 3 · Şablon ekle 2 · şablon seç 2 · şablonu yerleştir 2 · Oynat 1 · onay 5 · İndir 1. "Parçayı seç"in biri betiğin değerleri okuması içindi; gerçek yol 25 tık. Değerler: proje adı, En, Boy.

Duraksama noktaları:

1. **Şablon yerleştirme iyi** (`board-door-template-1440-light.png`, `-dark.png`): hayalet en yakın kenara yapışıyor (sol / sağ doğru algılandı), tık yerleştiriyor. Delikler doğru: yuvalar X 22,5, Y 108 ve 608 (aralık 500, kapakta ortalı); kulp X 566, Y 294 ve 422. Panelde "Kenar · Kenardan mesafe · Kenar boyunca · Adet · Aralık · Çap" ve "Aynala (sol / sağ kapak)" var.
2. **"Doğrulanacak" yalnızca menüde ve Şablonlar sayfasında** (`templates-page-1440-light.png`): şablon menüsü "Hazır şablon · ölçüler üretici verisiyle doğrulanacak" diyor; kapağa konduktan sonra panelde ("Menteşe çukuru Ø35 (2 menteşe) · sürüm 1"), Simülasyon'da, Dışa aktar'da ve dosyada bu bilgi yok. Yuva 12 mm derinlikle 18 mm kapakta kesiliyor; ölçü menteşeyle uyuşmazsa kapak çöpe gider. **Şimdi düzelt A.**
3. **Özellikler paneli 2.511 px** (#7'de 2.315): şablon örneği deliklerin altında, panelin en sonunda. Cila kuyruğunda zaten var; şablonla daha da uzadı.
4. **Dizilim delikleri hâlâ çizmiyor** (`layout-door-1440-light.png`): kapak düz dikdörtgen. Şablonda "aynala" olduğu için sol / sağ kapağı ayırt etmek artık bu adımda daha önemli. Cila (kuyrukta, öncelik yükselt).
5. **Simülasyon** (`sim-door-1440-light.png`): "Takımlar: T1 Ø6 mm → T2 Ø8 mm", "Program içinde 1 kez durup takım ister. Her değişimden sonra Z'yi yeniden sıfırlayın." Doğru ve açık.
6. **Dışa aktar** (`export-door-1440-light.png`): "Takım doğru mu? (T1 Ø6 mm → T2 Ø8 mm)" ve ayrı onay "Program içinde 1 kez durup takım ister. Her değişimden sonra Z'yi yeniden sıfırlayacağım." 5 onay, sonra İndir. #7 bulgusu A kapandı.

### G-code okuması: şablonlu kapak

| Konu | Dosyada | Değerlendirme |
| --- | --- | --- |
| Başlık | "(DOGRULANMADI, once air cut)", "(TAKIMLAR: T1 D6.000, T2 D8.000)", `G21 G90 G91.1 G17 G40 G49 G54`, `G0 Z20`, `M7`, takım sorusu + `M0`, `M3 S18000`, `G4 P5.0` | Kurallı. Şablon adı ve "doğrulanmamış ölçü" satırı yok (A) |
| Menteşe yuvası Ø35 × 12 (T1 Ø6) | Merkez X32,5 Y118 ve Y618 (parça plakada X10 Y10); helis yarıçapı 2,4 mm, halkalar 2,4 → 14,5 mm (adım ≈ 2,02 ≤ 0,4 × Ø6), en derin Z-12,0 | Doğru: 14,5 + 3 = 17,5 = Ø35 / 2 |
| Kulp Ø6 boydan boya (T1) | X576 Y294 / Y422 (+10), kademeli, en derin Z-18,5 | Doğru |
| Takım değişimi | `M5` → "(TAKIM DEGISTIR: T2 D8.000 - Z SIFIRLA - SONRA CYCLE START)" → `M0` → `M3`, `G4 P5.0` | Kurallı; #7 K2 uygulanmış |
| Sıra | T1: yuvalar + kulp → tek değişim → T2: dış kontur, 4 köprü | Delikler konturdan önce, tek değişim. #7 cila maddesi (fazla değişim) bu işte görülmüyor |
| Son | `G0 Z20 · M5 · M9 · M30` | Kurallı |

Küçük not (cila): koordinatlarda `Y117.9999`, `Y617.9999` gibi kayan nokta artıkları var (0,0001 mm, zararsız ama okuyanı şüphelendirir); dört basamağa yuvarlamadan önce temizlenmeli.

## Gezinti 3: DXF tabela (`sign-letters.dxf`, yaylarda köprü)

İş: "NOL" harfleri (580 × 200 mm, O'nun iç halkası var) içe aktar → diz → NC.

| Ölçü | #8 |
| --- | --- |
| Tık | **15** (Yeni proje 1 · proje adı 1 · İleri 4 · DXF aç 1 · dosya seç 1 · İçe aktar 1 · Oynat 1 · onay 4 · İndir 1) |
| Yazılan değer | **1** (proje adı) |
| Çıktı | `Adsiz_projeTabela_harfler_S1.tap`, 6,9 KB, 263 satır, kontroller geçti, ≈ 2 dk 10 sn, 16 köprü |

- **DXF penceresi** (`dxf-dialog-1440-light.png`): birim dosyadan okunuyor ("Milimetre (mm), dosyadan okundu"), rapor net (3 parça, 1 iç kontur, 9 nesne, yok sayılan HATCH 1, MTEXT 1), katman eşlemesi tek satır ve "şirket ayarı olarak hatırlanır". Düğme "3 parçayı ekle" sayıyı söylüyor. İyi.
- **Yaylarda köprü**: O harfinde köprüler `G3` yaylarının arasında, `G1 Z-15.0000` ile yükselip yay boyunca devam ediyor (satır 34–44); harfler küçük parça kuralıyla köprü aldı. D-049 / D-058'e uygun.
- **Simülasyon** (`sim-sign-1440-dark.png`): iş 2.800 × 2.070 plakanın köşesinde, 2D görünüm plakaya sığdırılmış; harfler okunmuyor. İşe sığdır görünümü yok (cila). "sign-letters.dxf: 3 parça eklendi · Geri al" bildirimi 4. adımda hâlâ duruyor ve G-code panelini örtüyor (cila).

## Gezinti 4: 3D önizleme ve oynatma

- **Dizilim 3D** (`layout-3d-1440-light.png`, `layout-3d-explode-1440-dark.png`): tek tıkla açılıyor; Basit mod, Plakayı taşı, Fireyi gizle, Ayır / kaldır, Üst / İzometrik / Ön, görünüm küpü. Damar dokusu parçada görünüyor. Parçalar adımında 3D yok (yalnızca Dizilim ve Simülasyon); bu tasarım kararı gibi duruyor, sorun değil.
- **Simülasyon 3D** (`sim-door-3d-1440-dark.png`): takım yolu bindirmesi açık geliyor, oynatma 5× hızda akıyor, alt satır o anki hareket, satır, X / Y / Z ve takımı gösteriyor, G-code paneli satırı izliyor. İyi.
- Sorunlar (cila): 3D araç çubuğu 1440'ta sağdan kırpık ("…etrik", "Ön"); küçük işte kamera plakaya sığıyor, kesilen parça köşede birkaç piksel ("işe sığdır" yok).

## Gezinti 5: dizilim modları ve iki plaka boyu

İş: Kontrplak 18 mm, ikinci boy 2.440 × 1.220 işaretli; KITCHEN listesi (30 parça).

| Ölçü | Değer |
| --- | --- |
| İkinci boyu seçmek | 3 tık (malzeme 2, boy 1), 1. adımda |
| Mod değiştirmek | 2 tık (kart + Diz); son sonuç kartta kalıyor |
| Sonuç | 3 plaka: 2 × 2.800 × 2.070 (fire %18) + 1 × 2.440 × 1.220 (fire %89,4); "Boylara göre" listesi doğru (`layout-sizes-1440-light.png`) |
| Süre | ilk diz 0,5 sn; "En hızlı" ve "En az takım değişimi" ≈ 3 sn, ilerleme çubuğu 3 sn içinde görülmedi (iptal bu ölçekte denenemedi) |

- Üç mod kartı bu iki işte de aynı sonucu gösteriyor ("3 plaka · fire %43,6"; iki dolapta "1 plaka · fire %25,3"). Kart yalnızca plaka ve fireyi yazıyor; "En hızlı"nın kazancı (yol, süre) kartta yok, kullanıcı modun bir şey yapıp yapmadığını göremiyor (`layout-modes-1440-dark.png`). Cila.
- Tek takımlı işte "En az takım değişimi" anlamsız; kart devre dışı ya da "tek takım" notuyla gösterilebilir. Cila.

## İyi olanlar (koruyun)

- **#7 kalıbının sürmesi**: çok takımlı kontrol listesi, Z sıfırla onayı ve dosya yorumu tek dilde; Simülasyon özeti aynı cümleyi söylüyor.
- **Şablon hayaleti kenara yapışıyor**; kapak işi 27 değerden 3'e indi. "Aynala (sol / sağ kapak)" doğru yerde.
- **Hazır kütüphane dürüst**: Şablonlar sayfasındaki sarı kutu ve "Doğrulanacak" rozeti. Aynı dürüstlük dosyaya kadar gitmeli (A).
- **DXF raporu**: birim kaynağı, yok sayılanların türü, sayılı ekle düğmesi.
- **Yaylarda köprü** sade: yükselme ve yay devamı okunur.
- **3D**: kontroller az ve anlaşılır, oynatma ile G-code paneli eşli.

## Şimdi düzelt (D-047: en çok 3 görev, her biri en çok yarım gün)

İki görev önerildi. Numaraları PO verir.

### A. Doğrulanmamış hazır şablon ölçüleri dosyaya ve kontrol listesine ulaşır

Neden "şimdi": yanlış çıktı riski. Hazır şablonların ölçüleri yer tutucu (`verified: false`, spec §14.2); bu bilgi yalnızca şablon menüsünde ve Şablonlar sayfasında görünüyor. Kapağa konduktan sonra panel, Simülasyon, Dışa aktar ve G-code sessiz. Yuva ölçüsü menteşeyle uyuşmazsa kapak çöpe gider.

Spec: §4.7, §7.2, §14.2 · Depends: T150, T151 · Decision: D-045 · **Human gate: golden dosya değişirse (`needs-human`, D-051)**

Acceptance:
- [ ] projede doğrulanmamış hazır şablondan gelen bir örnek varsa Dışa aktar kontrol listesine ayrı bir onay satırı eklenir: "Hazır şablon ölçüleri doğrulanmadı: Menteşe çukuru Ø35 (2 menteşe). Ölçüleri kendi menteşe / kulp verinizle karşılaştırdım." Onaylanmadan İndir açılmaz. Şirket şablonu ya da şirkete kopyalanıp düzenlenmiş şablonda satır çıkmaz
- [ ] Simülasyon özetinde aynı bilgi bir satırdır (sarı, Z sıfırla satırıyla aynı kalıp)
- [ ] özellikler panelinde şablon örneğinin başlığında "Doğrulanacak" rozeti görünür (Şablonlar sayfasındaki rozetle aynı)
- [ ] G-code başlığına ASCII bir yorum satırı eklenir: "(SABLON DOGRULANMADI: Mentese cukuru D35 2 mentese)"; yalnızca böyle bir örnek varsa. Diğer dosyalar ve golden'lar değişmez
- [ ] yarım günü aşarsa en küçük çözüm: ilk iki madde (kontrol listesi + özet) şimdi; rozet ve yorum satırı ayrı görev

Tester focus: hazır şablonlu kapak (satır var, onaysız İndir kapalı), şirket şablonlu kapak (satır yok), şablonsuz dolap (hiçbir şey değişmedi); inen dosyada yorum; 1440 açık / koyu; axe.

### B. Proje adı: varsayılan ad yazınca değişir, sonuna eklenmez

Neden "şimdi": her işte yanlış çıktı adı. Üç incelemedir görülüyor; bu turda beş gezintinin beşinde proje adı ve dosya adı "Adsız proje…" ile başladı (`Adsiz_projeMenteseli_kapa_S1.tap`). Makinenin USB'sinde dosyalar birbirinden ayırt edilemiyor; operatör yanlış programı yükleyebilir.

Spec: §3.6, §6.4 (dosya adı) · Depends: yok

Acceptance:
- [ ] ad varsayılan ("Adsız proje") iken alana tıklamak, odaklanmak ya da kalem simgesine basmak metnin tamamını seçer; yazılan ilk karakter varsayılanın yerine geçer
- [ ] kullanıcı adı değiştirmişse tıklama imleci tıklanan yere koyar (bugünkü davranış)
- [ ] Gezinti 1'in yolu (Yeni proje → ada tıkla → "Mutfak alt dolap 60" yaz) `Mutfak_alt_dolap_60_S1.tap` üretir; tık sayısı artmaz
- [ ] e2e: ada tıklayıp yazma; Esc ile vazgeçince ad değişmez

Tester focus: yeni proje, var olan projeyi yeniden adlandırma, geri al; 1440 ve 390 duman.

Zaten yazılı olup bu incelemede teyit edilenler (yeni görev yok): #7'nin A (çok takımlı kontrol listesi, Z sıfırla), B (delik hataları satırda) ve C (delik tıklanan yerde) bulguları kapandı; #7 cila kuyruğundaki "takım sırası fazla değişim" bu işte görülmedi.

## Cila kuyruğu (D-047)

PO'nun `docs/BACKLOG.md` "Polish queue (M9; D-047)" bölümüne eklemesi için:

- Dizilim: delikler ve şablon örnekleri parçanın üstünde çizilmiyor; aynalı sol / sağ kapak ayırt edilemiyor (kuyrukta; öncelik yükseltilsin) (`layout-door-1440-light.png`)
- Tahta: özellikler paneli şablonlu kapakta 2.511 px; şablon örneği panelin en altında; örnekleri ve delikleri kapalı satırlar olarak göster (kuyruktaki maddeyle birleştir)
- Simülasyon 3D: araç çubuğu 1440'ta sağdan kırpık ("…etrik", "Ön") (`sim-door-3d-1440-dark.png`)
- Simülasyon 2D / 3D: küçük işte görünüm plakaya sığıyor, iş köşede; "işe sığdır" görünümü ya da varsayılanı (`sim-sign-1440-dark.png`)
- Bildirim: "dosya.dxf: 3 parça eklendi · Geri al" adım değişince kapanmıyor, 4. adımda G-code panelini örtüyor; adım değişince kapansın
- Dizilim modları: kart yalnızca plaka ve fire yazıyor; "En hızlı" için yol / süre, "En az takım değişimi" için değişim sayısı da yazılsın; tek takımlı işte "En az takım değişimi" kartı not düşsün (`layout-modes-1440-dark.png`)
- Şablonlar sayfası: küçük resimler ölçekli değil (Ø35 yuva Ø6 delikten küçük görünüyor); kartta delik boyutları orantılı çizilsin (`templates-page-1440-light.png`)
- G-code: kayan nokta artığı (`Y117.9999`); dört basamağa yuvarlamadan önce temizlenmeli (golden etkisine bakılarak)
- Dizilim: "Diz" ilerleme çubuğunda metin yok (yalnızca çubuk); "Diziliyor… %40 · İptal" gibi bir satır

İnceleme #7 kuyruğundan bu turda çözülmüş görülenler: takım sırasında fazla değişim (kapak işinde tek değişim). Hâlâ açık ve yeniden görülen: Dizilim'de delik yok, uzun özellikler paneli, proje adı (B'ye taşındı).

## Karar verildi (sahibi isterse değiştirir)

Yeni kural yok. Var olan kuralların uygulaması:

- **K1 (D-045 ölçüsü):** tabanlar: dolap **16 / 5**; menteşeli kapak elle **38 / 27** (taban kalır), hazır şablonla **26 / 3** (yeni ikinci satır); DXF tabela **15 / 1** (yeni). L konsol bu turda ölçülmedi (değişen ekran yok).
- **K2 (§14.2'nin uygulaması):** doğrulanmamış hazır veri (şablon ölçüsü) dosyaya giden yolda her adımda ve dosyada söylenir; kontrol listesinde onay ister. "Örnek makine profili doğrulanmadı" kalıbıyla aynı.
- **K3 (D-047):** üç incelemede tekrar eden ve her işin çıktısını etkileyen cila maddesi "şimdi" listesine taşınır (B).

## Çıktılar

- `docs/reviews/2026-11-20-cto-design-review-8.md` ve `docs/reviews/2026-11-20-cto-8/` (15 görüntü).
- `docs/BACKLOG.md` ve `docs/DECISIONS.md`: değişmedi (triyaj PO'da).

## Görüntüler

Klasör: `docs/reviews/2026-11-20-cto-8/` (15 dosya; 1440 × 900).

| Ekran | Dosyalar |
| --- | --- |
| Kesim listesi | `cutlist-cabinet-1440-light.png` |
| Çizim tahtası: şablon | `board-door-template-1440-light.png`, `board-door-template-1440-dark.png` |
| DXF | `dxf-dialog-1440-light.png` |
| Dizilim | `layout-door-1440-light.png`, `layout-modes-1440-dark.png`, `layout-progress-1440-light.png`, `layout-sizes-1440-light.png`, `layout-3d-1440-light.png`, `layout-3d-explode-1440-dark.png` |
| Simülasyon | `sim-door-1440-light.png`, `sim-door-3d-1440-dark.png`, `sim-sign-1440-dark.png` |
| Dışa aktar | `export-door-1440-light.png` |
| Şablonlar | `templates-page-1440-light.png` |
