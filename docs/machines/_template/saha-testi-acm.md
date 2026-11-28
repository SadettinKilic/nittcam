# Saha testi ACM (kompozit panel): <makine adı>, <tarih>

Operatör:            Profil sürümü:            Post:            Panel: ACM ___ mm, renk kodu ___

Kompozit panel ayrı bir malzeme ailesidir (spec §7.3, D-118, D-138): ahşapta doğrulanmış makine ACM'de doğrulanmış sayılmaz. Bu test geçene kadar ACM dosyaları "DOĞRULANMADI" ve "DOGRULANMAMIS MALZEME: ACM" başlığıyla ve indirmede ayrı kabulle gelir.

## Hazırlık
- [ ] Makine profilinde bir ACM kesim ayarı var (Makineler → Kesim ayarları; başlangıç değerleri "doğrulanacak").
- [ ] Takım tablosunda açısı girilmiş bir V uç var (ör. T7, 90°, uç düzlüğü 0,2 mm).
- [ ] Hurda ACM panel en az 300 × 300 mm.
- [ ] Kumpas (0,01 mm) ve kalan kalınlık için derinlik ölçer veya mikrometre.
- [ ] Panel **yüzü aşağı** (film alta) yatırılır: parçalar aynalı kesilir, başlıkta "PLAKA ARKA YUZU USTTE" yazar.

## Dosyalar
Doğrulama → "Kompozit panel (ACM)" sekmesi veya Saha testi kiti → "ACM test tepsisi".

| Dosya | Çalıştırma saati | Gerçek süre | Sonuç |
| --- | --- | --- | --- |
| ACM_AIRCUT | | | |
| ACM_TEPSI | | | |

## Protokol
1. ACM air cut: Z 20 mm yukarıda, malzemeye temas yok. Eksenler, spindle, güvenli Z ve V-kanal yolları kontrol edilir; uygulamada air cut onaylanır.
2. V ucu takın, Z sıfırını alın (profildeki referans: tabla veya malzeme üstü).
3. ACM_TEPSI: 250 × 250 mm tepsi, köşelerde 25 mm kesik, 4 V-kanal (kanal merkezleri arası 200 mm). Kanallar dış konturdan önce, iki pasoda kesilir.
4. Kalan kalınlığı kanalın ortasında, panelin **alt (tabla) yüzünden** ölçün: hedef 0,8 mm ± 0,1.
5. Dört kenarı elle 90° katlayın. Ön yüzde (dekor yüzü) çatlak veya iz olmamalı.
6. Katlanmış tepsinin dış ölçüsünü X ve Y'de ölçün: hedef uygulamadaki değer (4 mm, 90° V, 0,2 mm uç: 200,97 mm) ± 0,5.
7. Ölçüleri Doğrulama → Kompozit panel (ACM) → Test kesimi formuna girin. Hepsi tolerans içindeyse makine ACM ailesinde "Doğrulanmış" olur.

## Ölçüler

| Ölçü | Hedef | Ölçülen | Fark |
| --- | --- | --- | --- |
| Kalan kalınlık, kanal 1 | 0,8 ± 0,1 | | |
| Kalan kalınlık, kanal 2 | 0,8 ± 0,1 | | |
| Kalan kalınlık, kanal 3 | 0,8 ± 0,1 | | |
| Kalan kalınlık, kanal 4 | 0,8 ± 0,1 | | |
| Katlanmış dış ölçü X | uygulamadaki değer ± 0,5 | | |
| Katlanmış dış ölçü Y | uygulamadaki değer ± 0,5 | | |

Forma kanallardan birinin (en kötü) değeri girilir; dördü de buraya yazılır.

## Gözlemler
- Ön yüzde iz, çatlak veya boya kalkması:
- Kanal kenarlarında çapak, erime (ilerleme / devir uygun mu):
- Panel kayması, vakum tutuşu:
- Film oku yönü doğru mu (yönlü: 180° dönmüş parça farklı görünür):
- Controller hata mesajları:
- Tahmini süre / gerçek süre:

## Sonuç
- [ ] Tüm ölçüler tolerans içinde, uygulamada ACM ailesi "Doğrulanmış".
- [ ] Sapmalar bir saha hatası kaydına ve önce başarısız bir teste dönüştü; kesim değerleri tablosu ölçümlerden düzeltildi (T357).
