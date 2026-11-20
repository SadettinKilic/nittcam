# CTO tasarım ve ürün incelemesi #10 (2026-11-20)

Kapsam: main `9c1eeaa` (kod `d00328a` ile aynı; M5, M6, M7 kapandı, M8 sırada). Önceki inceleme: `2026-11-20-cto-design-review-9.md`.

Bu inceleme iki parçalıdır:

1. **#9 ile aynı ölçüm**: üretim derlemesi, boş PGlite, port 3210, Playwright ile 1440 × 900 açık / koyu, üç operatör gezintisi (D-045). 390 px yalnızca duman testi (D-043).
2. **Eksik avı (yeni, sahibinin isteği)**: uygulama bir atölye operatörü gibi baştan sona kullanıldı: yeni proje → kesim listesi / çizim / şablon / DXF → dizilim → simülasyon → dışa aktarma; ayrıca Ana sayfa, Projeler, Artık parçalar, Makineler, Doğrulama, Şablonlar, Ayarlar, komut paleti. Her eksik için BACKLOG'da karşılığı olup olmadığı yazıldı.

30 görüntü `2026-11-20-cto-10/` klasöründe. Ürün koduna, BACKLOG'a ve DECISIONS'a dokunulmadı; e2e paketi çalıştırılmadı.

Uygulanan kurallar: **D-047** (en çok 3 "şimdi düzelt"), D-045 (gezinti sayımı), D-043 (önce masaüstü).

Sınırlar: tıklar betikte gerçek olay sayımıdır (`isTrusted`); dosya seçimi betikte tıksız yapıldığı için elle +1 eklendi. Bu turda denenmeyenler: sunucu kesintisi / çevrimdışı kayıt (T187), iki sekmede revizyon çakışması, silinen projenin doğrudan bağlantısı (T178'de zaten yazılı), 1024 px, dokunmatik. Konsolda hata görülmedi; tek uyarı `THREE.Clock … deprecated` (3D açılınca).

## Puanlar

| Başlık | #3 | #4 | #5 | #6 | #7 | #8 | #9 | #10 | Not |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 7 | 7,5 | 7,5 | 7,5 | 7,5 | 7,5 | 8 | **8** | Ana sayfa ve Projeler gerçek veriyle dolu, tutarlı. Tutan: kalan bildirim, montaj kamerası, boş taslakların listede birikmesi |
| Modernlik | 8 | 8 | 8 | 8 | 8 | 8,5 | 9 | **9** | Değişmedi. 3D, montaj, gerçek şekil, artık parça yerinde |
| Kullanılabilirlik | 7,5 | 7,5 | 8 | 8 | 8 | 8,5 | 8,5 | **8,5** | Üç gezinti aynı sayıda; T286 doğrulandı. Tutan: plakaya sığmayan parçada 4. adım "Tüm kontroller geçti" derken 5. adım kilitliyor (A); kesim ayarlarının (köprü, giriş, yön) arayüzü yok; proje her açılışta 1. adımdan başlıyor |
| M4–M7 için hazır olma | 7,5 | 8 | 8 | 8,5 | 8,5 | 9 | 9 | **9** | #9'un A bulgusu (T286) kapandı. Dosyalar kurallı, kontroller geçti |
| Saha testine hazır olma (yeni satır) | – | – | – | – | – | – | – | **7** | NC yolu sağlam. Eksik: PDF / etiket / DXF çıktısı (M8), kesim ayarı arayüzü, makine silme, proje durumu, yardım ve örnek proje (M9) |

Özet: NC üretim yolu (liste → dizilim → simülasyon → dosya) baştan sona çalışıyor, veri yenilemede kaybolmuyor, gezinti sayıları #9 ile aynı. Eksik avından **1 "şimdi düzelt"**, **7 yeni görev adayı**, **9 mevcut görevle örtüşen eksik** ve **12 cila** maddesi çıktı. En önemli yeni eksik: köprü (tab) adedi / ölçüsü, giriş tipi ve kesim yönü için hiçbir ekran yok; spec §6.3 bunları ayarlanır diye tarif ediyor.

## Gezinti 1: mutfak alt dolabı (D-045, tekrar)

| Ölçü | #7 | #8 | #9 | #10 |
| --- | --- | --- | --- | --- |
| Tık | 16 | 16 | 16 | **16** |
| Yazılan değer | 5 | 5 | 5 | **5** |
| Çıktı | 12,2 KB, 511 satır | `Adsiz_projeMutfak_alt_dol_S1.tap` | `Mutfak_alt_dolap_60_S1.tap`, 12,2 KB, 511 satır | **`Mutfak_alt_dolap_60_S1.tap`, 12,2 KB, 511 satır**, kontroller geçti, 1 plaka |

- Gerileme yok; Dizilim adımı kendiliğinden dizili açılıyor ("Diz"e basmak gerekmedi) (`cutlist-cabinet-1440-light.png`, `layout-cabinet-1440-light.png`, `sim-cabinet-1440-light.png`, `export-cabinet-1440-light.png`).
- Not: 8 büyük parçada 32 köprü var (parça başına 4). Vakumlu tablada büyük panele köprü gereksiz temizlik işidir; operatörün bunu değiştireceği bir yer yok (eksik E1).

## Gezinti 2: menteşeli kapak, 4 kenar bant + hazır şablon → NC

| Ölçü | #8 (tahtada çizim) | #9 (yapıştır + Yerleştir) | #10 (aynı yol) |
| --- | --- | --- | --- |
| Tık | 26 | 24 | **24** |
| Yazılan değer | 3 | 2 | **2** |
| Çıktı | 235 satır | `Menteseli_kapak_60_S1.tap`, 236 satır | **`Menteseli_kapak_60_S1.tap`, 6,7 KB, 236 satır**, kontroller geçti, T1 → T2, ≈ 2 dk 38 sn |

- **T286 doğrulandı (#9 A kapandı)**: panelden "Yerleştir" ile menteşe yuvaları X 22,5 (sol), kulp delikleri X 566 (596 − 30, sağ kenar); şablon örneğinin kenarı `right` (`board-door-1440-light.png`).
- Dışa aktar'da 6 onay (orijin, takım, takım değişimi, şablon, air cut, makine) eksiksiz; dosyanın 2. satırı `(SABLON DOGRULANMADI: …)` (`export-door-1440-light.png`, `sim-door-1440-light.png`).

## Gezinti 3: DXF tabela, iç boşluğa yerleştirme açık

| Ölçü | #8 | #9 | #10 |
| --- | --- | --- | --- |
| Tık | 15 | 16 | **16** (15 + dosya seçimi) |
| Yazılan değer | 1 | 1 | **1** |
| Çıktı | 263 satır | `Tabela_harfler_S1.tap`, 7,0 KB, 263 satır | **`Tabela_harfler_S1.tap`, 6,9 KB, 263 satır**, kontroller geçti |

- DXF penceresi raporu net: 3 parça, 1 iç kontur, 2 yok sayılan (HATCH, MTEXT), birim dosyadan (`dxf-dialog-1440-dark.png`).
- #9 cilaları aynen duruyor: harfler plakada çok küçük, "işe sığdır" yok, iç boşluk seçeneği sonuç değiştirmeyince geri bildirim yok (`layout-sign-inhole-1440-dark.png`).

## Eksik avı: ekran ekran notlar

**Ana sayfa** (`home-1440-light.png`): üç sayı kutusu (proje, bu hafta dışa aktarma, doğrulanmış makine), küçük dizilim resimli son projeler, makine doğrulama durumu, hızlı işlemler gerçek veriyle çalışıyor. Yok: fire özeti grafiği (spec §3.4), bakım hatırlatması. Kart altında "Son dışa aktarma 20 Kas 20…" kesiliyor.

**Projeler** (`projects-1440-light.png`): arama Türkçe harf katlamasıyla çalışıyor ("MUTFAK", "menteseli", "mach3", "mdf"). Kopyala ("… (kopya)"), Sil + "Geri al", son dosyayı listeden indir (indirilen dosya ilk indirilenle bayt bayt aynı) çalışıyor. Yok: filtre, sıralama, sayfalama, "Silinenler". Durum her projede "Taslak", NC indirildikten sonra da. "Aç" projeyi her zaman 1. adımda açıyor; sayfa başlığı ise "kaldığınız yerden devam edin" diyor.

**Artık parçalar** (`offcuts-1440-dark.png`): Dizilim'den kaydedilen parça listede (ölçü, malzeme, damar, kaynak proje, "Kullanıldı say"). Yok: elle artık parça ekleme (atölyede NittCam'den önce kalmış plakalar), silme, düzeltme. Sekme adreste tutulmuyor; yenileyince Projeler sekmesine dönüyor.

**Makineler ve Doğrulama** (`verify-1440-light.png`): yeni makine formu 11 bölümüyle açılıyor, düzenleme sürüm üretiyor. Doğrulama akışı çalışıyor: kabul → `AIRCUT_S1.tap` indir → 4 gözlem → "Air cut'ı onayla" → test kesimi ve 5 ölçüm alanı açılıyor; durum yenilemede korunuyor ve yeni dosyaların başlığına `(DOGRULAMA: AIR CUT ONAYLANDI …)` olarak geçiyor. Yok: **makine silme / arşivleme** (ne ekranda ne API'de), bakım kaydı.

**Şablonlar** (`templates-1440-dark.png`): 6 hazır şablon, kart menüsünde "Sürüm geçmişi" ve "Kopyala". Sorun görülmedi.

**Ayarlar**: menüdeki "Ayarlar" doğrudan Malzemeler'e gidiyor; başka sayfa yok (şirket, varsayılanlar, DXF katman eşleme, görünüm, yoğunluk).

**Komut paleti**: sayfalarda yalnız Ana sayfa, Projeler, Makineler var; Şablonlar, Ayarlar / Malzemeler, Doğrulama yok. "pdf", "dxf" gibi aramalar boş dönüyor.

**1. adım (Makine ve plaka)**: makine, malzeme (Mermer "yakında"), kalınlık, ince tabaka, plaka boyları, özel ölçü, tablaya sığmayan plaka uyarısı, 2D / 3D önizleme çalışıyor.

**2. adım (Parçalar)**: yapıştırma, sütun eşleme, satır menüsü (Çoğalt, Yukarı, Aşağı, Sil), sıralama, arama, gruplama, hatalı satır süzgeci, CSV dışa aktarma (`kesim-listesi.csv`) çalışıyor. Yazıp hemen yenileme (150 ms) ve hücreyi onaylamadan sayfadan çıkma denendi: **veri kaybı yok**. Çizim tahtasında tur açıkken çizim yapılabiliyor; adım ve görünüm adreste tutulduğu için yenilemede korunuyor (`board-empty-tour-1440-light.png`). Tahtada sağ tık menüsü yok.

**3. adım (Dizilim)**: modlar, döndürme seçenekleri, 3D, montaj, artık parça kaydı çalışıyor (`layout-cabinet-1440-dark.png`, `layout-cabinet-3d-1440-dark.png`, `assembly-3d-1440-dark.png`). Plakaya sığmayan parça olduğunda uyarı sol panelde katın altında kalıyor; tuvalde hiçbir iz yok (A).

**4. adım (Simülasyon)**: oynatma, hız, G-code satırına tıklama çalışıyor (`sim-cabinet-play-1440-dark.png`). Köprü, giriş ve yön ayarı için bir panel yok; "Ayarlar ve uyarılar" yalnız bilgi gösteriyor (E1).

**5. adım (Dışa aktar)**: yalnız NC. Çok plakalı işte "İndir" dosya indirmiyor, önce kaydı oluşturup "Her plakanın dosyasını ayrı indirin" diye 3 bağlantı gösteriyor; 3 plaka = 4 tık, toplu indirme yok (`export-3sheets-1440-light.png`). Geçmiş tablosu doğru doluyor (`export-history-1440-light.png`). Onay kutuları proje yeniden açılınca sıfırlanıyor (doğru).

**Telefon 390 (duman)**: 11 ekranda yatay kaydırma yok; sihirbazda "İleri" görünür (`home-390-light.png`, `layout-390-light.png`). 5. adımda "İleri" yok, "İndir" var (doğru).

## Şimdi düzelt (D-047: en çok 3; bu tur 1)

Numarayı PO verir.

### A. Plakaya sığmayan parça: 4. adım "Tüm kontroller geçti" demesin, 5. adım hangi parça olduğunu söylesin

Neden "şimdi": yanlış durum bilgisi + çıkışı gösterilmeyen kilit. Deneme: "Raf 564 × 520 × 4" ve "Tezgah 3000 × 600 × 1" yapıştırıldı (2.800 × 2.070 plaka).

- Kesim listesi: "1 sorun" çipi var (doğru) (`cutlist-oversize-1440-light.png`).
- Dizilim: 4 raf dizili, tuval temiz görünüyor; "1 parça dizilimde yok" ve hata satırı sol panelde, 1440 × 900'de katın altında. Adım "tamamlandı" işaretleniyor (`layout-oversize-1440-light.png`).
- Simülasyon: özet rozeti **"✓ Tüm kontroller geçti"** (`data-ok="true"`); hata, kapalı duran "1 uyarı" satırının içinde (`sim-oversize-1440-light.png`).
- Dışa aktar: "1 kontrol geçmedi. Bu dosya indirilemez." Neden: "Takım yolu · Parça plakaya sığmıyor (kenar payı dahil)". Parça adı, satır numarası ve düzeltme bağlantısı yok (`export-oversize-1440-light.png`).

Operatör dört adım boyunca "her şey tamam" görüyor, son adımda adı verilmeyen bir parça yüzünden bütün iş kilitleniyor. Aynı kalıp: dizilimden sonra eklenen parça.

Spec: §3.6, §6.5, §7.2 · Depends: T176'dan önce yapılabilir

Acceptance:
- [ ] dizilimde olmayan (sığmayan ya da sonradan eklenen) parça varken Simülasyon özeti "Tüm kontroller geçti" göstermez; "1 kontrol geçmedi" + parça adıyla satır açık gelir; Dışa aktar ile aynı sonuç kaynağı kullanılır
- [ ] Dışa aktar'daki "Geçmeyen kontroller" satırı parçayı adıyla yazar ("Satır 2 · Tezgah: plakaya sığmıyor") ve "Parçalara git" bağlantısı o satırı odaklar
- [ ] Dizilim'de dizilemeyen parça sayısı tuvalin üstünde, kaydırmadan görünür (plaka sekmelerinin yanında uyarı çipi); "İleri" engellenmez
- [ ] golden G-code dosyaları değişmez; NC kilidi gevşemez (kontrol geçmeden indirme yok)
- [ ] yarım günü aşarsa en küçük çözüm: ilk iki madde

Tester focus: sığmayan parça, dizilimden sonra eklenen parça, parça silinince üç adımın da yeşile dönmesi; 1440 açık / koyu; axe.

## Eksikler → yeni görev (BACKLOG'da karşılığı yok)

Numarayı ve partiyi PO verir. Milestone önerisi her maddede.

### E1. Kesim ayarları için arayüz yok: köprü (tab), giriş tipi, kesim yönü · **NEW · M8 (B28 ile) ya da saha testinden önce M9**

Spec §6.3: "Tab: adet, genişlik ve yükseklik ayarlanır", "lead-in (yay veya düz)", "climb / conventional seçimi". Proje şemasında `tabs`, `leadIn`, `direction` alanları var; bunları değiştiren bir komut ve ekran yok (komut katmanında yalnız `setThinSkin` var), makine formunun "Malzeme parametreleri" tablosunda da köprü sütunları yok. T182 yalnız şirket varsayılanlarını ("defaults: gap, margin, tabs, lead-in") kapsıyor; proje bazında ayar ve varsayılanın nereden geldiği görünmüyor.

Acceptance: Simülasyon adımının sol panelinde "Kesim ayarları": köprü (her parçada / yalnız küçük parçada / kapalı), adet, genişlik, yükseklik; giriş (yay / düz); yön (climb / conventional). Her değişiklik bir komut (geri alınır), önizleme ve köprü sayısı anında güncellenir, sunucudaki dışa aktarma aynı değerleri kullanır; köprü kapalıyken küçük parça güvenlik kuralı (§6.3, §7.2) köprüyü ya da ince tabakayı yine zorlar. Golden etkisi tester ile.

### E2. Makine silinemiyor / arşivlenemiyor · **NEW · M8 (B28, T181 yanında)**

Spec §3.4 "ekle / çıkar / düzenle". Listede yalnız "Doğrula" ve "Düzenle"; `api/machines` altında DELETE / arşiv yok. Örnek makine, kendi makinesini ekleyen atölyede sonsuza dek "doğrulama bekliyor" sayılır (Ana sayfa "0 / 1").

Acceptance: makine arşivlenir (yumuşak silme, "Geri al"); arşivli makine yeni projede seçilemez, onu kullanan eski projeler açılır ve eski dışa aktarmalar kalır; Ana sayfa sayıları arşivliyi saymaz; örnek makine de arşivlenebilir.

### E3. Artık parça stoğu: elle ekleme, silme, düzeltme yok · **NEW · M8 (B27 ile) ya da M9**

Yalnız Dizilim'den kayıt ve "Kullanıldı say" var. Atölyenin elindeki eski artıklar girilemiyor, yanlış kaydedilen silinemiyor. (Spec §6.2 yalnız dizilimden kaydı söylüyor; elle ekleme sahibinin kapsam kararı.)

Acceptance: "Artık parça ekle" (malzeme, kalınlık, en, boy, damar); satırda düzelt ve sil ("Geri al" ile); sekme adreste tutulur (`?sekme=artik`).

### E4. Çok plakalı işte toplu indirme · **NEW (T176'ya kabul maddesi olarak eklenebilir) · M8**

3 plaka = "İndir" + 3 ayrı bağlantı. "İndir" tıklanınca hiçbir dosya inmiyor, yalnız bağlantılar çıkıyor; ilk kez gören durur.

Acceptance: birden çok dosyada "Tümünü indir (.zip)" tek tıkla iner (dosya adları ve içerik tek tek indirilenle aynı, hash'ler geçmişte aynı); tek tek indirme kalır; zip içinde `OKU.txt` plaka → dosya eşlemesi.

### E5. Proje kaldığı adımdan açılsın · **NEW · M8 (T178 / T179 ile)**

"Aç" her zaman 1. adım. 5. adıma kadar gelmiş projede operatör her seferinde 4 tık atıyor.

Acceptance: proje, tamamlanmış son adımın bir sonrasında açılır (dizilim varsa Dizilim, dışa aktarma varsa Dışa aktar); adresle gelen `?adim=` önceliklidir; Çizim / Liste görünümü hatırlanır (#7 cilasıyla birleşir).

### E6. Aynı revizyon, farklı dosya özeti: doğrulama durumu değişince · **NEW (karar + T179 kabul maddesi) · M8**

"Tabela harfler" Rev. 3: indirilen dosya `da38e6fe…` (7,0 KB), air cut onayından sonra aynı revizyonun güncel dosyası `8313661a…` (7,1 KB). Sebep doğru (başlıktaki `DOGRULAMA:` satırı değişti) ama geçmiş satırı ile "Dosyalar" kartı aynı revizyon için iki ayrı özet gösteriyor ve T179'un "eski revizyondan yeniden dışa aktarma aynı hash'i verir" kabulü bu durumda tutmaz.

Acceptance: dışa aktarma kaydı doğrulama durumunu da saklar (bugün tabloda görünüyor); yeniden dışa aktarma ya o günkü durumla aynı baytları verir ya da "doğrulama durumu değişti, yeni dosya" diye ayrı kayıt açar; karar DECISIONS'a yazılır.

### E7. Başka kalınlıktaki parçalar için yol yok (dolap arkalığı 8 mm) · **NEW · saha testinden sonra ya da M9; sahibinin kapsam kararı**

"Dolap ekle" arkalığı dürüstçe "8 mm · ayrı plaka" diye dışarıda bırakıyor, ama o parçaların gideceği yer yok: operatör ikinci projeyi elle açıp ölçüleri yeniden yazmalı.

Acceptance (en küçük): dolap penceresinde / kesim listesinde "Ayrı plaka parçalarını yeni projeye aktar" → aynı makine, seçilen malzeme / kalınlıkla yeni proje, parçalar hazır. Proje içinde çok malzeme bu görevin dışında.

## Eksikler: mevcut görevle örtüşenler (yeni görev gerekmez)

| Eksik | Görev |
| --- | --- |
| PDF (dizilim sayfaları, parça listesi, bant, fire raporu) yok; çok plakalı işte hangi parça hangi plakada kâğıda dökülemiyor | T172, T173 |
| Parça etiketi yok | T174 |
| DXF dışa aktarma yok | T175 |
| Dışa aktar adımı yalnız NC; geçmişten yeniden indirme / eski revizyondan üretme yok | T176, T179 |
| Proje durumu hep "Taslak" (NC indirildikten sonra da) | T179 |
| Projeler: filtre, sıralama, sayfalama, "Silinenler", silinen projenin doğrudan bağlantısı | T178 |
| Ana sayfa: fire özeti grafiği, büyük küçük resim, bakım hatırlatması | T180, T181 |
| Makine bakım kaydı, kontrol ünitesi kütüphanesiyle ön doldurma | T181 |
| Ayarlar: şirket, varsayılanlar, DXF katman eşleme, görünüm, yoğunluk, kısayol listesi | T182, T183 |
| İlk kullanım: karşılama, örnek proje, yardım sayfaları | T184, T192 |
| Kayıt hatası / çevrimdışı / revizyon çakışması (bu turda denenmedi) | T187 |

Not (T180): Ana sayfanın sayı kutuları ve son projeler bölümü zaten gerçek veriyle çalışıyor; görevden geriye grafik, büyük küçük resim ve bakım rozeti kalıyor.

Not (T178): kopyala ve arama da zaten çalışıyor; kalan: filtre, sıralama, sayfalama, "Silinenler", bağlantı engeli.

## Cila kuyruğu (D-047)

PO'nun `docs/BACKLOG.md` "Polish queue (M9; D-047)" bölümüne eklemesi için (12 madde):

- Komut paleti: Şablonlar, Ayarlar / Malzemeler ve Makine doğrulama sayfaları yok; proje içindeyken adım komutları ("Dizilime git", "Dışa aktar") yok
- Boş taslaklar birikiyor: "Yeni proje" + tek dokunuş (ad ya da plaka ölçüsü) 0 parçalı kalıcı proje bırakıyor; Ana sayfa "Son projeler" bunlarla doluyor (`home-1440-light.png`). Parçasız taslakları son projelerde gösterme ya da 0 parçalıyı ayrı süz
- Ana sayfa proje kartı: "Son dışa aktarma 20 Kas 20…" kesiliyor (`home-1440-light.png`)
- Artık parça kaydı: "Stoğa kaydet" sonrası bildirim yok, yalnız panelde küçük yazı ("1 artık parça stoğa kaydedildi."); Artık parçalar listesinde kaynak projenin adı yok, yalnız "Projeyi aç"
- Artık parçalar sekmesi adreste tutulmuyor; yenileyince Projeler sekmesi açılıyor
- Çok plakalı dışa aktarmada "İndir" düğmesinin adı işi anlatmıyor ("Dosyaları hazırla" gibi); E4 gelene kadar en azından metin
- Simülasyon: görünüm araç çubuğu tabla çerçevesinin sağ üst köşesini örtüyor (`sim-oversize-1440-light.png`)
- Kesim listesi: yalnız adı yazılmış, ölçüsüz satır alt bilgide parça sayısına ekleniyor ("7 satır · toplam 32 parça")
- Yapıştırma: 7 satırlık metinde ölçüsü 0 olan satır için düğme "Uygula (6 satır)" diyor; atlanan satır ve nedeni önizlemede açıkça yazsın (bu turda önizleme metni ayrıca okunmadı, kontrol edilsin)
- Çizim tahtası: sağ tık menüsü yok (çoğalt, sil, döndür, şablon ekle)
- Konsol: `THREE.Clock: This module has been deprecated. Please use THREE.Timer` uyarısı her 3D açılışında
- #9 kuyruğundan hâlâ açık (yeniden görüldü): adım değişince kalan bildirim ölçek çubuğunu örtüyor (`layout-oversize-1440-light.png`), montaj kamerasında dolabın altı kırpık (`assembly-3d-1440-dark.png`), küçük işte "işe sığdır" yok, iç boşluk / gerçek şekil sonuç değiştirmeyince geri bildirim yok

## İyi olanlar (koruyun)

- Üç gezinti #9 ile aynı sayıda ve aynı dosyalarla bitti; T286 tam doğru yerde.
- Veri dayanıklılığı: hemen yenileme ve onaysız hücreden çıkma veri kaybettirmedi; adım ve görünüm adreste.
- Doğrulama akışı baştan sona tutarlı; durum dosya başlığına ve geçmiş tablosuna yansıyor.
- Projeler'de kopyala, sil + geri al, listeden son dosyayı indir (bayt bayt aynı) beklenenden önce hazır.
- Dolap üretici, başka kalınlıktaki arkalığı sessizce 18 mm'den kestirmiyor.
- Telefon 390: 11 ekranda yatay kaydırma yok.

## Karar verildi (sahibi isterse değiştirir)

- **K1 (D-045 ölçüsü):** dolap **16 / 5**, menteşeli kapak (yapıştır + Yerleştir) **24 / 2**, DXF tabela iç boşluk açıkken **16 / 1**; üçü de değişmedi.
- **K2:** bir adımın özet rozeti ("Tüm kontroller geçti") Dışa aktar'ın kilit kararıyla aynı kaynaktan gelmeli; iki adım birbirini yalanlamamalı (A'nın genel kuralı).
- **K3:** spec'in "ayarlanır" dediği her üretim değeri (köprü, giriş, yön) için en az bir ekran olmalı; ekranı olmayan değer dosya başlığında ya da Simülasyon özetinde okunur olmalı (E1).

## Çıktılar

- `docs/reviews/2026-11-20-cto-design-review-10.md` ve `docs/reviews/2026-11-20-cto-10/` (30 görüntü; 1440 × 900, ikisi 390 × 844).
- `docs/BACKLOG.md` ve `docs/DECISIONS.md`: değişmedi (triyaj PO'da).

| Ekran | Dosyalar |
| --- | --- |
| Ana sayfa | `home-1440-light.png`, `home-390-light.png` |
| Projeler / Artık parçalar | `projects-1440-light.png`, `offcuts-1440-dark.png` |
| Makine doğrulama | `verify-1440-light.png` |
| Şablonlar | `templates-1440-dark.png` |
| Kesim listesi | `cutlist-cabinet-1440-light.png`, `cutlist-door-band-1440-light.png`, `cutlist-oversize-1440-light.png`, `dxf-dialog-1440-dark.png` |
| Çizim tahtası | `board-door-1440-light.png`, `board-empty-tour-1440-light.png` |
| Dizilim | `layout-cabinet-1440-light.png`, `layout-cabinet-1440-dark.png`, `layout-cabinet-3d-1440-dark.png`, `assembly-3d-1440-dark.png`, `layout-door-1440-light.png`, `layout-sign-inhole-1440-dark.png`, `layout-oversize-1440-light.png`, `layout-390-light.png` |
| Simülasyon | `sim-cabinet-1440-light.png`, `sim-cabinet-play-1440-dark.png`, `sim-door-1440-light.png`, `sim-sign-1440-dark.png`, `sim-oversize-1440-light.png` |
| Dışa aktar | `export-cabinet-1440-light.png`, `export-door-1440-light.png`, `export-3sheets-1440-light.png`, `export-history-1440-light.png`, `export-oversize-1440-light.png` |
