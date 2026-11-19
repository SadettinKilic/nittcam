# CTO tasarım incelemesi #7 (2026-11-19)

Kapsam: main `8deb6c9` (B14 #70, B13 #77 ve B13a #81 sonrası; M4 kapandı). Önceki inceleme: `2026-11-19-cto-design-review-6.md`.

Yöntem: uygulama üretim derlemesiyle ve boş bir PGlite veritabanıyla 3210 portunda çalıştırıldı (inceleme #6 ile aynı kurulum). İnceleme `385342b` üzerinde başladı; B13a main'e girince dal güncellendi, yeniden derlendi ve bütün gezintiler ile ölçümler boş veritabanıyla `8deb6c9` üzerinde tekrarlandı. Playwright ile tek tarayıcıda 1440 × 900 (açık ve koyu) ve 1024 × 768'de değişen ekranlar gezildi: çizim tahtası (delik aracı, delik özellikleri, tanıtım turu, ipucu çubuğu, kısayol penceresi), kesim listesi, Dizilim, Simülasyon, Dışa aktar, 1. adım, makine formu "Takımlar". 390 × 844 yalnızca "kırılıyor mu" diye ölçüldü. 33 görüntü `2026-11-19-cto-7/` klasöründe. Ürün koduna, BACKLOG'a ve DECISIONS'a dokunulmadı; e2e paketi çalıştırılmadı.

Uygulanan kurallar: **D-047** (bulgular "şimdi düzelt" ve "cila kuyruğu" diye ayrılır; en çok 3 görev), D-043 (önce masaüstü), D-045 (operatör gezintisi her incelemede), D-050 (delik takım yolları).

Sınırlar: gezintileri bir insan değil betik yaptı; tık ve değer sayıları gerçek, süre tahmindir. Fare tekerleğiyle yakınlaştırma tık sayılmadı; alanlar arasında Tab ile geçiş tık sayılmadı. Gezintilerde konsol hatası veya sayfa hatası görülmedi. İnen dosyalar elle okundu (aşağıda). **B16 (DXF içe aktarma, #80) inceleme bittiğinde main'de değildi; DXF tabela gezintisi yapılmadı, inceleme #8'e kaldı.** T267 (CSV küçük ölçü) ve T271 arayüzden denenmedi (birim testleri var). Zaten yazılı olan konular yeniden açılmadı: tamamı yaylardan oluşan küçük parçada köprü (T143 / T272), delik aracında uzak görünümde ikinci tıkın merkeze yapışması, tur kartının 1440'ta tahtanın altını örtmesi, BACKLOG "Polish queue (M9)" maddeleri.

## Puanlar

| Başlık | #3 | #4 | #5 | #6 | #7 | Not |
| --- | --- | --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 7 | 7,5 | 7,5 | 7,5 | 7,5 | Tur kartı, kısayol penceresi ve "Son sürüme geç" kutusu iki temada da düzgün ve aynı dilde. Puanı tutan: altı delikli bir kapakta özellikler paneli 2.315 px (görünen 673 px), delik hataları adsız ve dört kez aynı satır, delik ipucu durum çubuğunda kırpık, reddedilen delik bildirimi paneli örtüyor |
| Modernlik | 8 | 8 | 8 | 8 | 8 | Canlı çapla delik aracı, klavyeyle yürüyen 5 adımlı tur, her araç için ipucu, "?" penceresi güncel CAD hissini koruyor. Sıçrama yok: delik tuvalde seçilemiyor, Dizilim'de görünmüyor |
| Kullanılabilirlik | 7,5 | 7,5 | 8 | 8 | 8 | İnceleme #6'nın iki bulgusu kapandı (önizleme = dosya; küçük göbek çizildiği yerde yakalanıyor). Dolap 16 / 5, L konsol 22 / 12 aynı. 8,5'i tutan yeni iş: menteşeli kapak 38 tık / 27 değer, menteşe yuvası olması gereken yere fareyle konamıyor, takımdan küçük delik ilk kez 3.–4. adımda ve "hangi delik" denmeden kilitliyor |
| M4–M6 için hazır olma | 7,5 | 8 | 8 | 8,5 | 8,5 | M4 çıkış ölçütü e2e ile kapandı. Delik uçtan uca çalışıyor ve G-code'u kurallı (helis giriş, dalma hızı, kademeli delme, doğru derinlik). 9'u tutan: ilk kez çok takımlı program üretiliyor ama kontrol listesi yalnızca bir takımı soruyor ve elle takım değişiminde Z'yi yeniden sıfırlamayı kimse söylemiyor; takım sırası gereksiz bir değişim daha yaptırıyor |

Özet: B13a iki "şimdi düzelt" bulgusunu tam kapattı ve iyi bir kalıp bıraktı (hata satırda, adımda kırmızı nokta, "Çizimde aç"). B14'ün deliği o kalıbın dışında kaldı. Bu incelemenin üç bulgusu yeni bir özellik istemiyor: delik için aynı kalıbı, çok takımlı program için dürüst bir kontrol listesi ve menteşe yuvasının tıklanan yere konmasını istiyor.

## Gezinti 1: mutfak alt dolabı (D-045, tekrar)

İş: 600 × 720 × 560 alt dolap + 2 raf (dolap üreticisi), elle bir ek parça (Baza 564 × 100), simüle et, G-code indir. Malzeme: varsayılan (MDF 18 mm).

| Ölçü | #4 | #5 | #6 | #7 |
| --- | --- | --- | --- | --- |
| Tık | 19 | 17 | 16 | **16** |
| Yazılan değer | 5 | 5 | 5 | **5** |
| Ekran | 5 adım + 1 pencere | 5 adım + 1 pencere | 5 adım + 1 pencere | 5 adım + 1 pencere |
| Betik süresi | 12,9 sn | 20,1 sn | 12,2 sn | 11,8 sn (karşılaştırılamaz) |
| Çıktı | 14,0 KB | 12,2 KB | 12,5 KB, 510 satır | `Mutfak_alt_dolap_60_S1.tap`, 12,2 KB, 511 satır, bütün kontroller geçti, 1 plaka |

Tıkların dağılımı değişmedi: Yeni proje 1 · proje adı 1 · İleri 4 · Dolap ekle 3 · Satır ekle 1 · Oynat 1 · güvenlik onayı 4 · İndir 1.

Not: yeni projede proje adı alanı odakta ve seçili geliyor; operatör tıklamadan yazarsa iş 15 tıkla biter. Alana tıklayan kullanıcıda seçim kalkıyor ve yazdığı ad "Adsız proje"nin sonuna ekleniyor (ilk denemede dosya adı `Adsiz_projeMutfak_alt_dol_S1.tap` oldu). Cila.

Sonuç: taban 16 / 5, gerileme yok (`cutlist-cabinet-1440-light.png`, `sim-cabinet-1440-light.png`).

## Gezinti 2: çizim tahtasında L raf konsolu (D-045, tekrar)

İş: 200 × 150 mm, kol kalınlığı 40 mm L konsol; dış köşe R15, iç köşeye dogbone; İndir.

| Ölçü | #5 | #6 | #7 |
| --- | --- | --- | --- |
| Tık | 23 | 22 | **22** |
| Yazılan değer | 12 | 12 | **12** |
| Ekran | 5 adım; tekerlekle 5 çentik | 5 adım; tekerlekle 5 çentik | 5 adım; tekerlekle **9 çentik** |
| Çıktı | kontroller geçti | `Raf_konsolu_S1.tap`, 2,6 KB, 104 satır | `Raf_konsolu_S1.tap`, 2,5 KB, 105 satır, kontroller geçti |

Çıktı elle doğrulandı: dış köşe `G2 … J-19` (R15 + takım yarıçapı 4), iç köşede takım merkezi X117,17 Y52,83, 4 köprü. İnceleme #6 ile aynı geometri (`board-corner-1440-light.png`, `board-dogbone-1440-light.png`).

Duraksama (yeni ölçüm): beş çentik yakınlaştırmada (%45) dış köşeye tıklamak köşeyi değil 40 mm'lik kenarı seçti ("Kenar 2"); kenarın orta tutamacı köşeye 9 px. Köşe ancak %92'de (9 çentik) seçilebildi. İnceleme #6'nın "küçük parçada etiketler üst üste" maddesiyle aynı kök (küçük parça küçük çiziliyor); kuyruktaki "seçime yakınlaş" maddesi bunu da çözer. Yeni görev yok.

## Gezinti 3: menteşeli kapak (yeni; D-045 tabanına eklendi)

İş: 596 × 716 kapak tahtada çizilir; 2 menteşe yuvası (Ø35 × 12,5 kör, kenardan 22,5 mm, alttan ve üstten 100 mm) ve 4 adet Ø5 boydan boya delik; diz, simüle et, NC indir. Ø5 delik için makinede Ø5 takım gerekir; örnek makinede yalnızca Ø6 ve Ø8 var.

| Ölçü | Takım makinede hazırken (taban) | İlk kez (takım yok, yolda öğreniliyor) |
| --- | --- | --- |
| Tık | **38** | 58 |
| Yazılan değer | **27** | 28 |
| Ekran | 5 adım | 5 adım + Makineler + makine formu + Projeler |
| Betik süresi | 14,9 sn | ölçülmedi |
| Çıktı | `Menteseli_kapak_S1.tap`, 8,0 KB, 285 satır, bütün kontroller geçti, ≈ 3 dk 3 sn | aynı program |

Taban yolun dağılımı (38 tık): Yeni proje 1 · proje adı 1 · İleri 4 · Çizim 1 · Dikdörtgen aracı 1 · ilk köşe 1 · Delik aracı 1 · 6 delik × 2 tık 12 · Seç aracı 1 · parçayı seç 1 · "Boydan boya" kapat 2 · çap alanı 6 · Oynat 1 · onay 4 · İndir 1. Değerler (27): proje adı 1, En / Boy 2, yuva başına 4 (çap, X, Y, derinlik) × 2, küçük delik başına 4 (çap, X, Y, takım no) × 4. 27 değerin 16'sı aynı dört sayının tekrarı (5 ve 3 dörder kez, 35 ve 12,5 ikişer kez).

Tek seferlik takım ekleme (Makineler → Düzenle → Takımlar → Satır ekle → çap 5 → Kaydet): 6 tık, 1 değer (`machine-tool-added-1440-light.png`). Yeni satır no 3, "Düz freze", kesici boyu 22 ile geliyor; iyi varsayılan.

İlk kez yolun fazlası (20 tık): Simülasyon'daki kırmızı kutudan Makineler'e 1, takım ekleme 5, Projeler ve projeyi aç 2, "Son sürüme geç" 1, Parçalar 1, Çizim 1 (görünüm hatırlanmıyor), parçayı seç 1, dört delikte takım no alanı 4, yeniden İleri 3 ve Oynat 1.

Duraksama noktaları (akış sırasıyla):

1. **Menteşe yuvası olması gereken yere konamıyor** (`board-hole-edge-refused-1440-light.png`). Tahta plakanın tamamıyla açılıyor (%18); bu ölçekte ızgara 100 mm. Kenardan 22,5 mm içeriye tıklanan merkez kenara yapışıyor ve "Delik buraya eklenemedi: parçanın içinde kalmalı ve iç boşluklara değmemeli." bildirimi çıkıyor. Tıklanan nokta parçanın içinde; mesaj yanlış yeri gösteriyor. Kenara 50 mm'den yakın her tık aynı sonucu veriyor; (50, 100) ve (80, 100) tıkları ise ikisi de (100, 100)'e yapışıp üst üste iki delik bırakıyor (uyarı yok). Çalışan yollar: deliği ortaya bırakıp konumu yazmak, Alt'ı basılı tutmak (yalnızca turun 4. adımında yazıyor) ya da %90'a yakınlaşmak. Bildirim sağ altta, özellikler panelinin alt satırlarını örtüyor. Gezinti, altı deliği ortaya bırakıp konumu yazarak sayıldı.
2. **Delik aracında çap yazılamıyor.** Dikdörtgen "En;Boy yazın", çember "R yazın" diyor; delik aracında merkezden sonra "35 Enter" hiçbir şey yapmıyor. Çap ancak delik bittikten, Seç aracına dönülüp parça seçildikten sonra panelde yazılıyor. İpucu durum çubuğunda kırpık: "Parçanın üstünde merkeze tıkla, çapı sürükleyer…" (`board-hint-hole-1440-light.png`); tam metin yalnızca fareyle üstüne gelince. Çember aracı yarıçap, delik çap soruyor: Ø24 için çembere "24" yazan kişi Ø48 alıyor.
3. **Delikler panelin en altında ve çok uzun** (`board-door-holes-1440-light.png`, `board-door-holes-1024-light.png`). "Delikler" grubu Parça, Damar, İşlem, Kenar ve Köşe gruplarından sonra geliyor; altı delik 1.488 px, panelin tamamı 2.315 px (1440'ta 673, 1024'te 488 px görünüyor). Tuvaldeki deliğe tıklamak parçayı seçiyor, satırına götürmüyor; delik sürüklenemiyor (parça taşınıyor); tuvalde delik numarası yok. "Delik 5" hangisi, sayarak bulunuyor. İnceleme #6'nın "iç kesim düzenlenemiyor" maddesinin delikteki hali; burada en azından alanlar var.
4. **Takımdan küçük delik tahtada sessizce kabul ediliyor** (`board-hole-d5-tool8-1440-light.png`). Ø5 delik, Ø8 takımla (T2, varsayılan) yazılınca panelde hata yok. Aynı şekilde makinede olmayan takım no (9) ve plaka kalınlığına eşit ya da büyük kör derinlik (18, 30) de kabul ediliyor; panel yalnızca "parçanın dışına taşıyor"u reddediyor ve onu da genel bir cümleyle ("delik parçanın içinde kalmalı, derinlik ve kanal genişliği geçerli olmalı"). Hata ilk kez liste görünümündeki "Hatalı satırlar 1" çipinde (`cutlist-hole-errors-1440-light.png`; tahtada çalışan kişi görmez), sonra Dizilim'in "Uyarılar" kartında (`layout-hole-errors-1440-light.png`) ve Simülasyon'da kilit olarak çıkıyor (`sim-hole-d5-blocked-1440-light.png`): "Tüm program · Delik çapı takım çapından küçük." dört kez, parça ve delik adı yok, tek bağlantı "Makineler sayfası", adım göstergesinde Parçalar "tamamlandı". B13a'nın küçük göbek için kurduğu kalıp (satırda hata, Parçalar'da kırmızı nokta, "Parça 1 · İç kesim 1", "Çizimde aç") delik hatalarına uygulanmamış. **Şimdi düzelt B.**
5. **"Takım no" çıplak bir sayı.** Alan makinedeki takımları göstermiyor; operatör T3'ün Ø5 olduğunu ezberden yazıyor. Aynı çaplı dört delik için dört kez çap, dört kez takım no yazılıyor; delik kopyalama, "sonrakine aynısını uygula" ya da son değeri hatırlama yok.
6. **Makineden dönüş** (ilk kez yol): kırmızı kutunun bağlantısı Makineler listesine gidiyor; "Kesim ayarı ekle" akışındaki "Projeye dön" burada yok, dönüş Projeler üzerinden. Proje açılınca 1. adımda "Makine profili güncellendi … [Son sürüme geç]" kutusu ve dört hata doğru yerde (B13a; `wizard-step1-version-gap-1440-light.png`). Parçalar adımı listeyle açılıyor; son kullanılan Çizim görünümü hatırlanmıyor.
7. **Dizilim delikleri çizmiyor** (`layout-door-1440-light.png`, `layout-door-1024-light.png`): kapak düz bir dikdörtgen. Parça döndürülünce ya da damar için çevrilince menteşe yuvalarının hangi kenara geldiği bu adımda görülemiyor; ilk kez Simülasyon'da, o da yalnızca yol olarak.
8. **Simülasyon** (`sim-door-1440-light.png`, `sim-door-1440-dark.png`, `sim-door-1024-light.png`): "Tüm kontroller geçti", 253 hareket, "Takım değişimi 3". Sayı baştaki "takılı mı?" sorusunu da sayıyor; program içinde elle değişim 2. Alttaki durum satırı o anki takımı gösteriyor (T2 · Ø 8 mm); iyi.
9. **Dışa aktar kontrol listesi yalnızca bir takımı soruyor** (`export-door-1440-light.png`): "Takım doğru mu? (T2 Ø8 mm)". Program T2 ile başlıyor, T3'e geçiyor, T2'ye dönüyor. **Şimdi düzelt A.**

Sonuç: iş bitiyor ve dosya kurallı. Taban **38 tık / 27 değer**; bir kapak için fazla, ama asıl maliyet tık değil: yuvanın tıklanan yere konmaması ve hatanın geç, adsız gelmesi. Şablonlar (B18) bu işi birkaç tıka indirecek; delik aracı yine de tek başına doğru çalışmalı.

## G-code okuması: menteşeli kapak

`Menteseli_kapak_S1.tap` satır satır okundu (parça plakada X10 Y10'da).

| Konu | Dosyada | Değerlendirme |
| --- | --- | --- |
| Başlık ve başlangıç | "(DOGRULANMADI, once air cut)", "(TAKIMLAR: T2 D8.000, T3 D5.000)", `G21 G90 G91.1 G17 G40 G49 G54`, `G0 Z20`, `M7`, takım sorusu + `M0`, `M3 S18000`, `G4 P5.0` | Kurallı |
| Menteşe yuvası Ø35 × 12,5 (T2) | Merkez X32,5 Y110 ve Y626. `G0 Z2` → `G1 Z0 F1500` → yarıçapı 3,2 mm helis (`G3 … Z-0.5208 … F1500`), tur başına 1,04 mm iniş (≈ 3°), paso başına 4 tur; pasolar Z-4,1666 / Z-8,3333 / Z-12,5000. Her pasoda tabanda F6000 ile dışa doğru halkalar: 3,2 → 5,775 → 8,35 → 10,925 → 13,5 mm (adım 2,575 mm ≤ 0,4 × Ø8). En dış halka 13,5 = 17,5 − 4: duvar tam Ø35 | Doğru. Malzemeye yalnızca dalma hızıyla giriliyor; en derin Z-12,5 (altta 5,5 mm kalıyor); yuva duvarı ile kapak kenarı arası 5 mm. D-050 ile uyumlu |
| Ø5 boydan boya delik (T3), 4 adet | Her delikte `G0 Z2` → `G1 Z-4.6250 F1500` → `G0 Z2` → `G1 Z-9.2500` → `G0 Z2` → `G1 Z-13.8750` → `G0 Z2` → `G1 Z-18.5000` → `G0 Z2` → `G0 Z20` | Doğru. Dört kademe (4,625 mm ≤ 6 mm paso), her kademeden sonra talaş için Z2'ye çıkış, yeniden giriş Z2'den itibaren dalma hızıyla (G83 yok, D-050); en derin Z-18,5 = kalınlık + 0,5. Eksi Z'de XY hareketi yok |
| Dış kontur (T2) | Yay ile giriş (`G3 … J-4`), dört paso Z-4,625 … Z-18,5, son pasoda 4 köprü Z-15, yay ile çıkış | Doğru; köprüler yuvalarla çakışmıyor (sol kenarda Y512–530, yuvalar Y110 ve Y626) |
| Sıra | T2: iki yuva → `M5` + "(TAKIM DEGISTIR: T3 D5.000, sonra cycle start)" + `M0` → T3: dört delik → `M5` + "(TAKIM DEGISTIR: T2 D8.000 …)" + `M0` → T2: dış kontur | Kurala uygun (delikler dış konturdan önce) ama bir değişim fazla: aşağıda madde 2 |
| Takım değişimi | Değişimden önce `G0 Z20` ve `M5`; sonra `G0 Z20`, `M3 S18000`, `G4 P5.0`, XY, `G0 Z2` | Kurallı. Eksik olan aşağıda madde 1 |
| Son | `G0 Z20 · M5 · M9 · M30` | Kurallı |

Bulgular:

1. **Elle takım değişiminde Z sıfırı (güvenlik; şimdi düzelt A).** Örnek makine: elle takım değişimi, takım boyu telafisi yok (`G49`, `G43` yazılmıyor), Z sıfırı malzeme üstü. Yeni takılan takımın pensten çıkan boyu öncekiyle aynı olmaz; Z yeniden sıfırlanmazsa sonraki `G1 Z-18.5000` farkın kadar derine (tablaya) ya da sığa iner. Dosyadaki mesaj yalnızca "TAKIM DEGISTIR: T3 D5.000, sonra cycle start" diyor; Simülasyon, Dışa aktar kontrol listesi ve başlık da Z'den söz etmiyor. B14'e kadar her program tek takımlıydı; bu risk delikle birlikte ilk kez erişilir oldu. Bağımsız okuyucu bunu yakalayamaz (takım boyu dosyada yok); söylenecek yer mesaj ve kontrol listesi.
2. **Takım sırası bir değişim fazla yaptırıyor (cila, en değerli aday).** Sıra T2 → T3 → T2: iki elle değişim. T3 delikleri önce delinse (T3 → T2) tek değişim yeter ve "delikler dış konturdan önce" kuralı yine tutar. Dizilim modu "En az takım değişimi" seçilince de sonuç aynı (3). Sıralayıcı ilk takımı "en yakın hazır iş"ten seçiyor; dış kontur hangi takımı bekliyorsa onu sona bırakan bir ilk seçim bu işi çözer. Golden dosya etkisi var (`holes-through_S1.tap` da T2 → T1 → T2).
3. **Değişim konumu.** Program değişim için takımı son işin üstünde, malzemeden 20 mm yukarıda bırakıyor; park konumu ya da Z'yi yukarı alma yok. Pens anahtarıyla 20 mm'de takım değiştirmek zor; operatör Z'yi elle kaldırır, sonra zaten yeniden sıfırlar. Makineye bağlı bir konu (spec §12.3, saha testi listesi); görev değil, sahibinin makine notlarına eklenmeli.
4. **Ø5 takım Ø8'in değerleriyle çalışıyor.** Devir, dalma hızı ve paso malzeme ayarından geliyor (takım başına değer henüz yok, D-050). MDF'de Ø5 için 1.500 mm/dk dalma kabul edilebilir; akrilik ya da Ø3 için olmayabilir. Saha testinde bakılacak; cila.

Diğer dosyalar: dolap ve konsol dosyaları inceleme #6'daki yapıyla aynı (başlık, güvenli Z, `M0`, ısınma, dalma hızı, en derin Z-18,5, köprü Z-15, son satırlar). Açık bir kural ihlali görülmedi.

## B13a: önizleme = dosya, küçük göbek çizildiği yerde (doğrulandı)

**T269** dolap projesinde ölçüldü: proje sürüm 1'e bağlı, makinede MDF pasosu 6 → 9 yapıldı (sürüm 3).

| Ekran | "Son sürüme geç"ten önce | Sonra |
| --- | --- | --- |
| 1. adım (`wizard-step1-version-gap-1440-light.png`) | "sürüm 1", "6 mm paso", kutu: "proje sürüm 1 ile kaydedildi, son sürüm 3. Önizleme ve dosya projenin sürümüyle (sürüm 1) yapılır." | sürüm 3 |
| Dizilim | "Takım Ø8" (projenin sürümünden) | aynı |
| Simülasyon (`sim-version-gap-1440-light.png`) | "sürüm 1", "(PROFIL: … surum 1)", ilk dalma `G1 Z-4.6250`, 32 paso, ≈ 13 dk 2 sn, kutu ve düğme | "surum 3", `G1 Z-6.1666`, 24 paso, ≈ 10 dk 1 sn |
| Dışa aktar (`export-version-gap-1440-light.png`) | "profil sürüm 1", aynı kutu | "profil sürüm 3", kutu yok, Geri al açık |
| İnen dosya | "surum 1", `G1 Z-4.6250`, 511 satır | "surum 3", `G1 Z-6.1666`, 431 satır |

Önizleme ile dosya iki durumda da aynı; sürümü değiştiren tek şey kullanıcının tıkı. İnceleme #6 bulgusu A kapandı.

**T270** Ø24 çemberle 1440 ve 1024'te ölçüldü (`board-slug-error-1440-light.png`, `board-slug-error-1024-light.png`, `sim-slug-blocked-1440-light.png`, `export-slug-blocked-1440-light.png`): panelde iç kesim satırının altında "İç kesim 1: göbeğe 2 köprü sığmıyor; kesici onu fırlatabilir. Açıklığı büyütün ya da delik aracıyla çizin."; Parçalar adımında kırmızı nokta ve her adımda görünür; listede "Hatalı satırlar 1"; Simülasyon ve Dışa aktar'da "Parça 1 · İç kesim 1 … [Çizimde aç]", düğme Parçalar → Çizim'i parça seçili açıyor; "Makineler sayfası" bağlantısı yok; "Uyarılar" kartı hatayı sayıyor. Önerilen çözüm artık var (delik aracı). İnceleme #6 bulgusu B kapandı.

Kalan (zaten kuyrukta): "İç kesim olarak ekle?" penceresinde düğme hâlâ 18 px taşıyor (pencere x = 944, düğme x = 962; 1024'te 736 / 754), odak "Vazgeç"te.

## B13: tur, ipuçları, kısayol penceresi

- **Tur** (`tour-1-1440-light.png`, `tour-1-1440-dark.png`, `tour-1-1024-light.png`): ilk açılışta 5 adım (Araçlar burada · Ölçüyle çizin · Sonra düzenleyin · Sıradaki adım altta · Kısayollar ve tur), Enter ile ilerliyor, Esc atlıyor, bir kez gösteriliyor ve "?" penceresinden yeniden başlatılıyor. Metinler kısa ve doğru. Eksik: delik için tek söz yok ("delik" yalnızca araç adlarında geçiyor); çap, kör / geçme ve takım no panelde seçiliyor bilgisi turun 3. adımına bir cümle olarak girebilir. Cila.
- **İpucu çubuğu**: sekiz aracın sekizinde de metin var. Seç ve Delik ipuçları 1440'ta, Kaydır da 1024'te kırpılıyor. Delik ipucu "tıkla, büyüt, bitir" diyor; diğer bütün ipuçları "tıklayın" (sen / siz karışmış). Cila.
- **Kısayol penceresi** (`board-shortcuts-1440-light.png`, `board-shortcuts-1024-light.png`): 21 satır, 1024 × 768'e sığıyor, altta "Tanıtım turunu başlat" ve "Tüm kısayollar". Eksik: Alt (yapışmayı geçici kapat) listede yok; turda var. Cila.
- **M4 çıkış e2e'si** (T137) incelemede çalıştırılmadı; aynı akış Gezinti 2'de elle geçildi.

## Dar ekran ve telefon

1024 × 768: tahta tuvali 590 × 485, Simülasyon 590 × 326 (inceleme #6 ile aynı; hedefler tutuyor). Delikler grubu 240 px genişliğinde panelin içinde, sayfa düzeyinde yana kayma 0 px.

Telefon (390 × 844) duman testi: ana sayfa, Projeler, Makineler, Ayarlar, 1. adım, liste, tahta (tur ve kısayol penceresi dahil), Dizilim, Simülasyon ve Dışa aktar'da sayfa düzeyinde yatay kayma 0 px; "İleri" (x = 293, y = 792) her adımda erişilebilir. Kısayol penceresi 358 × 784 (ekran 390 × 844) sığıyor.

## İyi olanlar (koruyun)

- **B13a kalıbı**: hata satırın altında, adımda kırmızı nokta, kutuda parça ve öğe adı, "Çizimde aç". Bundan sonra kilitleyen her yeni kural bu kalıpla gelmeli.
- **"Son sürüme geç" kutusu üç adımda aynı**: cümle neyin hangi sürümle yapılacağını söylüyor; tek tık, tek geri alma.
- **Delik takım yolları**: helis giriş, duvarda tam çap, boydan boya delikte göbek bırakmayan boşaltma, kademeli delme. D-050'nin sade tercihi (G83 yok) dosyayı okunur ve denetlenir tutuyor.
- **Küçük göbek mesajı delik aracını öneriyor**: iki özellik birbirine bağlandı.
- **Tur**: beş kısa adım, klavyeyle, bir kez; yeniden başlatma yeri belli.
- **Yeni takım satırının varsayılanları** (no, tip, kesici boyu): takım eklemek 6 tık, 1 değer.

## Şimdi düzelt (D-047: en çok 3 görev, her biri en çok yarım gün)

Üç görev önerildi. Numaraları PO verir.

### A. Çok takımlı program: kontrol listesi bütün takımları sorar, elle değişim Z'yi hatırlatır

Neden "şimdi": makine güvenliği ve yanlış bilgi. Gönderim öncesi kontrol listesi programdaki takımlardan yalnızca birini soruyor; elle değişimde Z sıfırlanmazsa sonraki takım yanlış derinliğe iner.

Spec: §7.2, §6.4, §3.7 · Depends: T139 · Decision: D-050 · **Human gate: golden dosya (`needs-human`, D-051)**

Acceptance:
- [ ] Dışa aktar kontrol listesindeki "Takım doğru mu?" satırı programın kullandığı bütün takımları kullanım sırasıyla yazar (kapak: "T2 Ø8 mm → T3 Ø5 mm → T2 Ø8 mm"); bugün yalnızca malzeme ayarının takımı yazıyor (`apps/web/lib/server/exports.ts`, `checklistOf`). Liste dosyayı üreten takım yolundan gelir, profilden tahmin edilmez
- [ ] programda elle takım değişimi varsa (takım değiştirici "elle", değişim sayısı ≥ 1) kontrol listesine ayrı bir onay satırı eklenir: "Program içinde N kez durup takım ister. Her değişimden sonra Z'yi yeniden sıfırlayacağım." (takım boyu telafisi açıksa ikinci cümle yazılmaz); onaylanmadan İndir açılmaz. Aynı bilgi Simülasyon özetinde bir satırdır
- [ ] elle değişim + takım boyu telafisi yok iken duraklama yorumu Z'yi söyler: "(TAKIM DEGISTIR: T3 D5.000 - Z SIFIRLA - SONRA CYCLE START)"; ASCII ve yorum uzunluğu sınırı içinde kalır. Otomatik değiştirici ve telafili profillerde metin değişmez
- [ ] Simülasyon özetindeki "Takım değişimi" program içindeki değişimleri sayar (kapak: 2); baştaki "takılı mı?" sorusu sayılmaz ya da ayrı yazılır
- [ ] golden dosyalardan yalnızca elle değişim içerenler değişir (`mach3/v1/golden/holes-through_S1.tap` ve varsa benzerleri) ve fark yalnızca yorum satırıdır; okuyucu kontrolleri (`TOOL_PROMPT_MISMATCH`, `TOOL_PAUSE_COUNT`) yeni metinle geçer
- [ ] yarım günü aşarsa en küçük çözüm: ilk iki madde (kontrol listesi) şimdi, yorum satırı ve golden ayrı görev

Tester focus: iki takımlı kapak projesi: kontrol listesi metni ve sırası, yeni onay olmadan İndir kapalı; tek takımlı projede hiçbir şey değişmedi; inen dosyada yorum satırı; golden farkının yalnızca yorum olduğu; G-code güvenlik incelemesi.

### B. Delik hataları çizildiği yerde yakalanır (B13a kalıbı)

Neden "şimdi": kilitleyen akış geç ve adressiz (D-045). Takımdan küçük delik, makinede olmayan takım ve geçersiz kör derinlik tahtada sessizce kabul ediliyor; Simülasyon "Tüm program · Delik çapı takım çapından küçük." diye dört kez kilitliyor.

Spec: §4.5, §3.7 · Depends: T138, T270 · Decision: D-045, D-050

Acceptance:
- [ ] özellikler panelinde hatalı deliğin satırının altında hata görünür (T270'teki iç kesim satırı gibi): çap < takım çapı ("Delik 3: Ø5, T2 takımından (Ø8) küçük. Daha ince bir takım seçin ya da çapı büyütün."), takım makinede yok ("Delik 3: T9 bu makinede yok."), kör derinlik ≥ kalınlık, kanal genişliği < takım çapı. Kural, takım yolunun reddettiği kuralla aynı çekirdek doğrulamadan gelir
- [ ] bu hatalar varken adım göstergesinde Parçalar kırmızı noktayı taşır ve nokta Dizilim, Simülasyon, Dışa aktar'da görünür kalır
- [ ] liste çipi, Dizilim "Uyarılar" kartı, Simülasyon ve Dışa aktar kutusu parçayı ve deliği adıyla yazar ("Kapak · Delik 3: …"), delik başına bir satır; kutunun düğmesi "Çizimde aç"tır ve Parçalar → Çizim'i o parça seçili, Delikler grubu görünür açar. "Makineler sayfası" bağlantısı yalnızca çözümü makinede olan hatada (takım yok / takım küçük değil) ikinci bağlantı olarak kalır
- [ ] "Takım no" alanının yanında seçili takımın çapı okunur ("3 · Ø5"); makinede olmayan numara yazılınca alan hatalı görünür
- [ ] D-050 kuralları, eşikler ve golden dosyalar değişmez; geçerli delikler bugünkü gibi geçer

Tester focus: Ø5 delik T2 ile, T9, kör derinlik 18 ve 30; her adımda nokta ve metin; "Çizimde aç"ın açtığı görünüm; delik düzeltilince hatanın her yerden kalkması; 1440 ve 1024; axe.

### C. Delik tıklanan yere konur: kenara yakın merkez reddedilmez

Neden "şimdi": çıkmaz akış. Deliğin en yaygın kullanımı olan menteşe yuvası (kenardan 22,5 mm) varsayılan görünümde fareyle konamıyor; mesaj da yanlış nedeni söylüyor.

Spec: §4.5, §4.4 · Depends: T138, T126

Acceptance:
- [ ] delik aracında merkez, yapışma sonucu parçanın kenarına ya da dışına düşüyorsa ama tıklanan nokta parçanın içindeyse, tıklanan nokta (en yakın tam mm'ye yuvarlanmış) kullanılır; %18 görünümde 596 × 716 parçada (22, 100) noktasına tıklamak delik ekler, "Delik buraya eklenemedi" çıkmaz
- [ ] gerçekten sığmayan delik (çapı kenarı aşıyor) yine reddedilir ve bildirim nedeni söyler ("Delik kenara çok yakın: çapı küçültün ya da merkezi içeri alın."); bildirim özellikler panelini örtmez (tuvalin altında, diğer tahta bildirimleri gibi)
- [ ] merkez tıklandıktan sonra sayı yazıp Enter'a basmak deliği o çapla bitirir (dikdörtgen ve çemberdeki "yazın" davranışı); ipucu bunu söyler ve durum çubuğuna sığar ("Merkezi tıklayın; çapı sürükleyin ya da yazın")
- [ ] aynı merkeze ikinci delik eklenmez (üst üste iki delik): uyarı verilir ya da var olan seçilir
- [ ] yarım günü aşarsa en küçük çözüm: ilk iki madde; yazılan çap ve üst üste delik cila kuyruğuna

Tester focus: %18, %45 ve %90'da kenara 20–50 mm tıklar; Alt ile ve Alt'sız; yazılan çap (35, 5, takımdan küçük değer); Esc ve Ctrl+Z; 1440 ve 1024.

Zaten yazılı olup bu incelemede teyit edilenler (yeni görev yok): T269, T270 kapandı; T136 (tur, ipucu, kısayol penceresi) kapandı.

## Cila kuyruğu (D-047)

PO'nun `docs/BACKLOG.md` "Polish queue (M9; D-047)" bölümüne eklemesi için (inceleme BACKLOG'a dokunmadı):

- Takım yolu: takım sırası gereksiz bir elle değişim yaptırıyor (kapak: T2 → T3 → T2; T3 → T2 yeterdi), "En az takım değişimi" modunda da aynı; ilk takım seçimi dış konturun takımını sona bıraksın. Golden etkisiyle değerlendirilsin; en değerli aday (G-code okuması, madde 2)
- Tahta: delik tuvalde seçilemiyor ve sürüklenemiyor, tuvalde delik numarası yok; deliğe tıklamak panelde kendi satırını açsın (`board-door-holes-1440-light.png`)
- Tahta: Delikler grubu panelin en altında ve altı delikte 1.488 px; delikleri kapalı satırlar (özet: "Delik 3 · Geçme · Ø5 · T3") olarak göster, seçileni aç; grubu Parça'nın hemen altına al (`board-door-holes-1024-light.png`)
- Tahta: aynı delikten birkaç tane yapmanın yolu yok (kopyala, aynala, "son deliğin değerleriyle devam et"); kapakta 27 değerin 16'sı tekrar
- Tahta: çember aracı yarıçap, delik çap soruyor; atölye çapla düşünür, çemberde de Ø yazılabilsin ya da ipucu "R (yarıçap)" desin
- Tahta: delik ipucu durum çubuğunda kırpık ve "tıkla / büyüt / bitir" diyor (diğerleri "tıklayın"); Seç ipucu 1440'ta, Kaydır ipucu 1024'te kırpık (`board-hint-hole-1440-light.png`)
- Tahta: kör ve boydan boya delik aynı çiziliyor; kör deliği farklı göster (ör. içi taralı) (`board-door-cup-zoom-1440-dark.png`)
- Dizilim: delikler ve iç kesimler parçanın üstünde çizilmiyor; döndürülen kapakta menteşe tarafı görülemiyor (`layout-door-1440-light.png`)
- Wizard: Simülasyon'daki kutudan Makineler'e giden kullanıcı için "Projeye dön" yok (kesim ayarı akışındaki dönüş burada da olsun); proje yeniden açılınca Parçalar son kullanılan görünümle (Çizim) açılsın
- Proje adı: alana tıklayınca seçim kalkıyor, yazılan ad "Adsız proje"nin sonuna ekleniyor; ad varsayılan iken odakta tümünü seç
- Kısayol penceresi: Alt (yapışmayı geçici kapat) listede yok; tur 3. adıma delik özellikleri için bir cümle (`board-shortcuts-1440-light.png`)
- Tahta: küçük parçada köşeye tıklamak %45'te kısa kenarın orta tutamacını seçiyor (40 mm kenar, 9 px); köşe tutamacına öncelik ver (Gezinti 2)
- Makine / takım yolu: delik takımı malzeme ayarının (Ø8) devir ve dalma değerleriyle çalışıyor; takım başına değer gelene kadar Simülasyon'da not düşülsün (G-code okuması, madde 4)
- Saha testi listesi (görev değil): elle takım değişiminde takım, malzemenin 20 mm üstünde ve son işin üzerinde duruyor; park konumu / Z'yi yukarı alma sahibinin makinesine göre kararlaştırılsın (spec §12.3)

İnceleme #6 kuyruğundan çözülenler: "Dışa aktar: profil sürümü farkı küçük sarı satır" (artık kutu), "Simülasyon / liste küçük göbekte ad vermiyor" (T270). Hâlâ açık ve yeniden ölçülen: "İç kesim olarak ekle?" düğme taşması.

## Karar verildi (sahibi isterse değiştirir)

Yeni kural yok. Aşağıdakiler var olan kuralların uygulamasıdır:

- **K1 (D-045 ölçüsü):** gezinti tabanı: dolap işi **16 tık / 5 değer**; L konsol **22 tık / 12 değer**; yeni üçüncü iş, menteşeli kapak (2 yuva + 4 delik, takım makinede hazır) **38 tık / 27 değer**. Şablonlar (B18) geldiğinde kapak işi şablonla ikinci bir satır olarak ölçülür; elle çizim tabanı kalır.
- **K2 (§7.2'nin uygulaması):** elle takım değişimi ve takım boyu telafisi olmayan profilde program, her değişimde Z'yi yeniden sıfırlamayı mesajda ve kontrol listesinde söyler. Bu bir yorum ve onay satırıdır; hareketler değişmez. Golden farkını D-051'e göre PO ve tester onaylar.
- **K3 (D-045'in devamı):** B13a kalıbı (satırda hata, adımda nokta, öğe adı, "Çizimde aç") kilitleyen her parça hatasının standart gösterimidir; delik hataları buna taşınır, DXF'ten gelen hatalar da (B16) aynı kalıpla gelmelidir.
- **K4:** takım sırasındaki fazla değişim cila kuyruğunda; çıktı kurallı olduğu için "şimdi" yapılmadı. PO isterse B15 / B18 ile alır.

## Çıktılar

- `docs/reviews/2026-11-19-cto-design-review-7.md` ve `docs/reviews/2026-11-19-cto-7/` (33 görüntü).
- `docs/BACKLOG.md` ve `docs/DECISIONS.md`: değişmedi (triyaj PO'da).

## Görüntüler

Klasör: `docs/reviews/2026-11-19-cto-7/` (33 dosya; 1440 × 900 ve 1024 × 768).

| Ekran | Dosyalar |
| --- | --- |
| Çizim tahtası: delik | `board-door-holes-1440-light.png`, `board-door-holes-1440-dark.png`, `board-door-holes-1024-light.png`, `board-door-cup-zoom-1440-dark.png`, `board-hole-edge-refused-1440-light.png`, `board-hole-d5-tool8-1440-light.png`, `board-hint-hole-1440-light.png` |
| Çizim tahtası: tur, kısayollar | `tour-1-1440-light.png`, `tour-1-1440-dark.png`, `tour-1-1024-light.png`, `board-shortcuts-1440-light.png`, `board-shortcuts-1024-light.png` |
| Çizim tahtası: köşe, küçük göbek | `board-corner-1440-light.png`, `board-dogbone-1440-light.png`, `board-slug-error-1440-light.png`, `board-slug-error-1024-light.png` |
| Kesim listesi | `cutlist-cabinet-1440-light.png`, `cutlist-hole-errors-1440-light.png` |
| Dizilim | `layout-door-1440-light.png`, `layout-door-1024-light.png`, `layout-hole-errors-1440-light.png` |
| Simülasyon | `sim-cabinet-1440-light.png`, `sim-door-1440-light.png`, `sim-door-1440-dark.png`, `sim-door-1024-light.png`, `sim-hole-d5-blocked-1440-light.png`, `sim-slug-blocked-1440-light.png`, `sim-version-gap-1440-light.png` |
| Dışa aktar | `export-door-1440-light.png`, `export-version-gap-1440-light.png`, `export-slug-blocked-1440-light.png` |
| 1. adım | `wizard-step1-version-gap-1440-light.png` |
| Makine formu | `machine-tool-added-1440-light.png` |
