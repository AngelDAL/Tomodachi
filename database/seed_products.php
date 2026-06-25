<?php
/**
 * Script para poblar productos de ejemplo en la tienda del administrador.
 * Uso: php database/seed_products.php
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../includes/Database.class.php';

$storeId = 1;
$userId = 1; // admin

// Mapeo de categorías conocidas del esquema base
$categories = [
    1 => 'Bebidas',
    2 => 'Snacks',
    3 => 'Abarrotes',
    4 => 'Lácteos',
];

// Listado de productos por categoría. Cada elemento: [nombre, descripción, precio_min, precio_max, stock_min, stock_max]
$productsByCategory = [
    1 => [ // Bebidas
        ['Coca Cola 355ml', 'Refresco de cola lata', 12, 16, 24, 120],
        ['Coca Cola 600ml', 'Refresco de cola', 15, 18, 30, 100],
        ['Coca Cola 1.5L', 'Refresco de cola familiar', 28, 35, 20, 80],
        ['Coca Cola 2.5L', 'Refresco de cola grande', 38, 48, 15, 60],
        ['Pepsi 355ml', 'Refresco de cola lata', 11, 15, 24, 120],
        ['Pepsi 600ml', 'Refresco de cola', 14, 17, 30, 100],
        ['Pepsi 1.5L', 'Refresco de cola familiar', 27, 34, 20, 80],
        ['Pepsi 2.5L', 'Refresco de cola grande', 37, 47, 15, 60],
        ['Fanta Naranja 600ml', 'Refresco de naranja', 14, 17, 25, 90],
        ['Fanta Naranja 2L', 'Refresco de naranja familiar', 32, 40, 15, 50],
        ['Sprite 600ml', 'Refresco de lima-limón', 14, 17, 25, 90],
        ['Sprite 2L', 'Refresco de lima-limón familiar', 32, 40, 15, 50],
        ['Mirinda Manzana 600ml', 'Refresco sabor manzana', 13, 16, 20, 80],
        ['Manzanita Sol 600ml', 'Refresco sabor manzana', 13, 16, 20, 80],
        ['7 Up 600ml', 'Refresco de lima-limón', 14, 17, 20, 80],
        ['Dr Pepper 355ml', 'Refresco sabor cereza', 16, 20, 15, 60],
        ['Agua Bonafont 1L', 'Agua purificada', 10, 13, 40, 150],
        ['Agua Ciel 1L', 'Agua purificada', 10, 13, 40, 150],
        ['Agua Epura 1L', 'Agua purificada', 10, 13, 40, 150],
        ['Agua Bonafont 500ml', 'Agua purificada individual', 7, 9, 50, 200],
        ['Agua Ciel 500ml', 'Agua purificada individual', 7, 9, 50, 200],
        ['Agua Topo Chico 600ml', 'Agua mineral', 16, 20, 20, 80],
        ['Agua Perrier 330ml', 'Agua mineral gasificada', 22, 28, 10, 40],
        ['Jugo Jumex Naranja 473ml', 'Jugo de naranja', 14, 18, 20, 80],
        ['Jugo Jumex Manzana 473ml', 'Jugo de manzana', 14, 18, 20, 80],
        ['Jugo Jumex Uva 473ml', 'Jugo de uva', 14, 18, 20, 80],
        ['Jugo Jumex Durazno 473ml', 'Jugo de durazno', 14, 18, 20, 80],
        ['Jugo del Valle Naranja 500ml', 'Jugo de naranja', 15, 19, 20, 80],
        ['Jugo del Valle Manzana 500ml', 'Jugo de manzana', 15, 19, 20, 80],
        ['Jugo del Valle Uva 500ml', 'Jugo de uva', 15, 19, 20, 80],
        ['Jumex Tetra Naranja 1L', 'Jugo de naranja familiar', 22, 28, 15, 50],
        ['Jumex Tetra Manzana 1L', 'Jugo de manzana familiar', 22, 28, 15, 50],
        ['Néctar Milex Naranja 1L', 'Néctar de naranja', 18, 24, 15, 50],
        ['Néctar Milex Durazno 1L', 'Néctar de durazno', 18, 24, 15, 50],
        ['Cerveza Corona 355ml', 'Cerveza clara', 18, 24, 30, 120],
        ['Cerveza Corona 1.2L', 'Cerveza clara familiar', 45, 55, 12, 40],
        ['Cerveza Victoria 355ml', 'Cerveza oscura', 17, 23, 30, 120],
        ['Cerveza Modelo Especial 355ml', 'Cerveza clara', 19, 25, 30, 120],
        ['Cerveza Negra Modelo 355ml', 'Cerveza oscura', 20, 26, 20, 80],
        ['Cerveza Pacífico 355ml', 'Cerveza clara', 17, 23, 30, 120],
        ['Cerveza Tecate 355ml', 'Cerveza clara', 15, 21, 30, 120],
        ['Cerveza Tecate Light 355ml', 'Cerveza light', 16, 22, 25, 100],
        ['Cerveza Indio 355ml', 'Cerveza oscura', 16, 22, 25, 100],
        ['Cerveza Sol 355ml', 'Cerveza clara', 17, 23, 25, 100],
        ['Cerveza Dos Equis 355ml', 'Cerveza clara', 19, 25, 20, 80],
        ['Cerveza Bohemia 355ml', 'Cerveza oscura', 19, 25, 20, 80],
        ['Vino Tinto Casillero del Diablo', 'Vino tinto chileno', 180, 240, 5, 20],
        ['Vino Tinto Concha y Toro', 'Vino tinto chileno', 150, 200, 5, 20],
        ['Vino Blanco Santa Carolina', 'Vino blanco chileno', 160, 220, 5, 20],
        ['Vino Rosado', 'Vino rosado', 140, 190, 5, 15],
        ['Tequila Jose Cuervo Especial', 'Tequila reposado', 280, 360, 3, 12],
        ['Tequila Don Julio 70', 'Tequila añejo cristalino', 850, 1100, 2, 6],
        ['Mezcal 400 Conejos', 'Mezcal artesanal', 320, 420, 3, 10],
        ['Ron Bacardi Blanco', 'Ron blanco', 240, 320, 3, 12],
        ['Ron Bacardi Añejo', 'Ron añejo', 290, 380, 3, 10],
        ['Vodka Smirnoff', 'Vodka neutro', 230, 300, 3, 12],
        ['Vodka Absolut', 'Vodka sueco', 380, 480, 2, 8],
        ['Whisky Johnnie Walker Red', 'Whisky escocés', 420, 550, 2, 8],
        ['Whisky Johnnie Walker Black', 'Whisky escocés 12 años', 780, 980, 2, 5],
        ['Whisky Buchanans', 'Whisky escocés', 520, 680, 2, 6],
        ['Licor Baileys', 'Licor de crema', 380, 480, 2, 8],
        ['Licor Kahlúa', 'Licor de café', 340, 440, 2, 8],
        ['Café Nescafé Clásico 225g', 'Café soluble', 75, 95, 10, 40],
        ['Café Nescafé Dolca 200g', 'Café soluble', 70, 90, 10, 40],
        ['Café Legal 250g', 'Café molido', 55, 75, 10, 40],
        ['Café soluble Starbucks', 'Café premium', 120, 160, 5, 20],
        ['Té Lipton Limón 20 bolsas', 'Té negro sabor limón', 28, 38, 10, 40],
        ['Té Lipton Manzanilla 20 bolsas', 'Té de manzanilla', 28, 38, 10, 40],
        ['Té Verde Lipton 20 bolsas', 'Té verde', 30, 40, 10, 40],
        ['Té Chaí Latte', 'Té especiado', 45, 60, 5, 20],
        ['Monster Energy 473ml', 'Bebida energética', 28, 38, 15, 60],
        ['Red Bull 250ml', 'Bebida energética', 42, 55, 15, 60],
        ['Powerade Moras 600ml', 'Bebida deportiva', 18, 24, 20, 80],
        ['Powerade Naranja 600ml', 'Bebida deportiva', 18, 24, 20, 80],
        ['Gatorade Limón 600ml', 'Bebida deportiva', 19, 25, 20, 80],
        ['Gatorade Naranja 600ml', 'Bebida deportiva', 19, 25, 20, 80],
        ['Gatorade Frutos Rojos 600ml', 'Bebida deportiva', 19, 25, 20, 80],
        ['Electrolit Naranja 625ml', 'Suero oral', 22, 28, 20, 80],
        ['Electrolit Fresa 625ml', 'Suero oral', 22, 28, 20, 80],
        ['Suero Oral Pedialyte 500ml', 'Hidratación oral', 45, 60, 10, 30],
        ['Refresco Sidral Mundet 2L', 'Refresco de manzana', 30, 38, 15, 50],
        ['Refresco Sangría Señorial 600ml', 'Refresco tipo sangría', 16, 22, 20, 70],
        ['Jarabe Rose\'s Lime', 'Concentrado de lima', 55, 75, 5, 20],
        ['Agua de Coco 1L', 'Agua de coco natural', 35, 48, 8, 25],
    ],
    2 => [ // Snacks
        ['Sabritas Original 45g', 'Papas fritas clásicas', 16, 22, 25, 100],
        ['Sabritas Adobadas 45g', 'Papas fritas sabor adobadas', 16, 22, 25, 100],
        ['Sabritas Limón 45g', 'Papas fritas sabor limón', 16, 22, 25, 100],
        ['Sabritas Sal y Limón 45g', 'Papas fritas sabor sal y limón', 16, 22, 25, 100],
        ['Sabritas Picantes 45g', 'Papas fritas sabor picante', 16, 22, 25, 100],
        ['Sabritas Clásicas 90g', 'Papas fritas clásicas grandes', 28, 38, 15, 60],
        ['Ruffles Queso 45g', 'Papas fritas sabor queso', 17, 23, 25, 100],
        ['Ruffles Original 45g', 'Papas fritas onduladas', 17, 23, 25, 100],
        ['Ruffles Jamón 45g', 'Papas fritas sabor jamón', 17, 23, 25, 100],
        ['Cheetos 45g', 'Botana de queso', 15, 21, 25, 100],
        ['Cheetos Flamin\' Hot 45g', 'Botana picante', 15, 21, 25, 100],
        ['Cheetos Poffs 45g', 'Botana de queso', 15, 21, 25, 100],
        ['Doritos Nacho 45g', 'Totopos sabor queso', 16, 22, 25, 100],
        ['Doritos Flamin\' Hot 45g', 'Totopos picantes', 16, 22, 25, 100],
        ['Doritos Taco 45g', 'Totopos sabor taco', 16, 22, 25, 100],
        ['Tostitos 200g', 'Totopos para dip', 35, 48, 12, 40],
        ['Tostitos Salsa Verde 200g', 'Totopos sabor salsa verde', 38, 52, 10, 35],
        ['Paketaxo Quezo 170g', 'Surtido de botanas', 42, 56, 10, 35],
        ['Paketaxo Botanero 170g', 'Surtido de botanas picosas', 42, 56, 10, 35],
        ['Churrumais 70g', 'Botana de maíz', 18, 25, 20, 80],
        ['Takis Fuego 55g', 'Botana de maíz picante', 16, 22, 25, 100],
        ['Takis Nitro 55g', 'Botana picante', 16, 22, 25, 100],
        ['Takis Guacamole 55g', 'Botana sabor guacamole', 16, 22, 25, 100],
        ['Runners 65g', 'Botana de maíz', 15, 21, 20, 80],
        ['Cacahuates Mafer Salados 150g', 'Cacahuates salados', 28, 38, 15, 50],
        ['Cacahuates Mafer Enchilados 150g', 'Cacahuates enchilados', 28, 38, 15, 50],
        ['Cacahuates Mafer Japonés 150g', 'Cacahuates estilo japonés', 30, 40, 15, 50],
        ['Cacahuates Mafer Limón 150g', 'Cacahuates sabor limón', 30, 40, 15, 50],
        ['Pistaches 100g', 'Pistaches salados', 55, 75, 8, 25],
        ['Almendras 100g', 'Almendras naturales', 48, 68, 8, 25],
        ['Nueces Mixtas 150g', 'Mix de nueces', 65, 85, 6, 20],
        ['Pasitas 150g', 'Uvas pasas', 28, 38, 10, 30],
        ['Ciruelas Pasas 150g', 'Ciruelas pasas', 32, 42, 10, 30],
        ['Oreo 114g', 'Galletas de chocolate con crema', 16, 22, 25, 100],
        ['Oreo Golden 114g', 'Galletas vainilla con crema', 16, 22, 25, 100],
        ['Chokis 100g', 'Galletas de chocolate', 14, 20, 25, 100],
        ['Emperador Chocolate 114g', 'Galletas de chocolate', 15, 21, 25, 100],
        ['Emperador Vainilla 114g', 'Galletas de vainilla', 15, 21, 25, 100],
        ['Galletas Marías Gamesa 170g', 'Galletas tipo María', 16, 22, 25, 100],
        ['Galletas Marías Gamesa 400g', 'Galletas tipo María grande', 28, 38, 15, 50],
        ['Galletas Cuétara 150g', 'Galletas dulces', 18, 25, 20, 80],
        ['Galletas Principe 150g', 'Galletas de chocolate rellenas', 18, 25, 20, 80],
        ['Galletas Maizena 200g', 'Galletas de maíz', 18, 25, 20, 80],
        ['Galletas Crackets 150g', 'Galletas saladas', 22, 30, 15, 50],
        ['Galletas Ritz 100g', 'Galletas saladas', 24, 32, 15, 50],
        ['Chips Ahoy 100g', 'Galletas con chispas de chocolate', 20, 28, 20, 80],
        ['Marathon 50g', 'Barra de chocolate con caramelo', 12, 16, 25, 100],
        ['Snickers 50g', 'Barra de chocolate con cacahuate', 14, 18, 25, 100],
        ['M&M\'s 49g', 'Chocolates cubiertos de caramelo', 16, 22, 25, 100],
        ['M&M\'s Peanut 49g', 'Chocolates con cacahuate', 16, 22, 25, 100],
        ['Hershey\'s 40g', 'Barra de chocolate', 14, 18, 25, 100],
        ['Kit Kat 45g', 'Barra de chocolate con wafer', 14, 18, 25, 100],
        ['Milky Way 52g', 'Barra de chocolate', 14, 18, 25, 100],
        ['3 Musketeers 54g', 'Barra de chocolate', 14, 18, 25, 100],
        ['Reese\'s 42g', 'Cacahuate cubierto de chocolate', 16, 22, 20, 80],
        ['Pelon Pelo Rico', 'Dulce de tamarindo', 8, 12, 30, 120],
        ['Pulparindo Original', 'Dulce de tamarindo', 6, 10, 30, 120],
        ['Pulparindo Watermelon', 'Dulce picante', 6, 10, 30, 120],
        ['Mazapán de la Rosa', 'Dulce de cacahuate', 7, 11, 30, 120],
        ['Miguelito Chamoy', 'Polvo picante', 5, 8, 30, 120],
        ['Lucas Muecas', 'Dulce picante con polvo', 10, 14, 25, 100],
        ['Lucas Skwinkles', 'Dulce enchilado', 10, 14, 25, 100],
        ['Rockaleta', 'Paletín picante', 10, 14, 25, 100],
        ['Rebanaditas', 'Paletín de sandía picante', 10, 14, 25, 100],
        ['Cucharitas Lucas', 'Dulce enchilado con cuchara', 10, 14, 25, 100],
        ['Chamoyada Bote', 'Dulce líquido de chamoy', 18, 25, 15, 50],
        ['Tamborines', 'Dulce de tamarindo enchilado', 16, 22, 20, 70],
        ['Rollo de Mango', 'Dulce de mango enchilado', 12, 16, 20, 80],
        ['Aciduladito', 'Dulce ácido', 8, 12, 25, 100],
        ['Paleta Payaso', 'Paleta de chocolate', 14, 18, 20, 80],
        ['Paleta Bubulubu', 'Bombón con gomita', 12, 16, 25, 100],
        ['Duvalin', 'Dulce tipo fondant', 8, 12, 30, 120],
        ['Carlos V 42g', 'Barra de chocolate', 14, 18, 25, 100],
        ['Crunch 42g', 'Barra de chocolate crocante', 14, 18, 25, 100],
        ['Larín 48g', 'Barra de chocolate con almendra', 14, 18, 25, 100],
        ['Principe Amor', 'Galleta de chocolate', 12, 16, 25, 100],
        ['Gloria Luneta', 'Dulce de leche', 8, 12, 25, 100],
        ['Obleas Ricas', 'Obleas con cajeta', 22, 30, 15, 50],
        ['Palanqueta de Cacahuate', 'Dulce tradicional', 15, 21, 15, 50],
        ['Alegría de Amaranto', 'Dulce tradicional', 12, 16, 15, 50],
        ['Chicloso', 'Dulce de leche crocante', 10, 14, 20, 80],
    ],
    3 => [ // Abarrotes
        ['Arroz Verde Valle 1kg', 'Arroz blanco', 24, 32, 20, 80],
        ['Arroz Verde Valle 900g', 'Arroz blanco', 22, 30, 20, 80],
        ['Arroz La Merced 1kg', 'Arroz blanco', 23, 31, 20, 80],
        ['Arroz SOS 1kg', 'Arroz blanco', 26, 34, 20, 80],
        ['Frijol Bayo 1kg', 'Frijol bayo', 32, 42, 15, 60],
        ['Frijol Negro 1kg', 'Frijol negro', 30, 40, 15, 60],
        ['Frijol Pinto 1kg', 'Frijol pinto', 30, 40, 15, 60],
        ['Frijol Peruano 1kg', 'Frijol peruano', 34, 44, 12, 50],
        ['Lentejas 500g', 'Lentejas secas', 18, 24, 15, 50],
        ['Garbanzo 500g', 'Garbanzo seco', 20, 28, 15, 50],
        ['Aceite 123 1L', 'Aceite vegetal', 38, 50, 15, 60],
        ['Aceite Nutrioli 1L', 'Aceite vegetal', 40, 52, 15, 60],
        ['Aceite Capullo 1L', 'Aceite de canola', 45, 60, 12, 50],
        ['Aceite de Oliva Extra Virgen 500ml', 'Aceite de oliva', 95, 130, 5, 20],
        ['Aceite de Oliva 250ml', 'Aceite de oliva', 55, 75, 8, 25],
        ['Azúcar Estándar 1kg', 'Azúcar refinada', 24, 32, 15, 60],
        ['Azúcar Morena 1kg', 'Azúcar morena', 26, 34, 15, 60],
        ['Sal La Fina 1kg', 'Sal refinada', 14, 18, 20, 80],
        ['Sal de Grano 1kg', 'Sal de grano', 18, 24, 15, 50],
        ['Harina de Trigo 1kg', 'Harina todo uso', 22, 30, 15, 60],
        ['Harina Hot Cakes 500g', 'Harina para hot cakes', 24, 32, 15, 50],
        ['Harina de Maíz 1kg', 'Masa harina', 28, 38, 15, 60],
        ['Harina de Arroz 500g', 'Harina de arroz', 32, 42, 8, 25],
        ['Pasta Spaghetti 500g', 'Pasta larga', 14, 20, 20, 80],
        ['Pasta Coditos 500g', 'Pasta corta', 14, 20, 20, 80],
        ['Pasta Penne 500g', 'Pasta corta', 15, 21, 20, 80],
        ['Pasta Fettuccine 500g', 'Pasta larga', 16, 22, 15, 60],
        ['Sopa de Pasta La Moderna 200g', 'Sopa de fideo', 10, 14, 25, 100],
        ['Sopa de Letras La Moderna 200g', 'Sopa de letras', 10, 14, 25, 100],
        ['Sopa de Coditos La Moderna 200g', 'Sopa de coditos', 10, 14, 25, 100],
        ['Salsa Catsup Heinz 397g', 'Catsup', 38, 50, 12, 40],
        ['Salsa Catsup Del Monte 397g', 'Catsup', 32, 44, 12, 40],
        ['Salsa Mayonesa Hellmann\'s 390g', 'Mayonesa', 42, 56, 10, 35],
        ['Salsa Mayonesa McCormick 400g', 'Mayonesa', 35, 48, 10, 35],
        ['Mostaza French\'s 226g', 'Mostaza', 32, 44, 10, 35],
        ['Salsa Barbacoa 250g', 'Salsa BBQ', 28, 38, 10, 35],
        ['Salsa Tipo Inglesa 150ml', 'Salsa inglesa', 22, 30, 10, 35],
        ['Salsa de Soya 250ml', 'Salsa de soya', 24, 32, 10, 35],
        ['Vinagre Blanco 500ml', 'Vinagre blanco', 14, 20, 15, 50],
        ['Vinagre de Manzana 500ml', 'Vinagre de manzana', 22, 30, 10, 35],
        ['Aceitunas 300g', 'Aceitunas verdes', 38, 52, 8, 25],
        ['Chiles en Vinagre 220g', 'Chiles jalapeños', 18, 25, 12, 40],
        ['Chipotle Adobado 220g', 'Chiles chipotle', 22, 30, 10, 35],
        ['Frijoles Refritos 430g', 'Frijoles refritos enlatados', 22, 30, 15, 50],
        ['Elote en Grano 400g', 'Elote enlatado', 18, 25, 12, 40],
        ['Champiñones Rebanados 400g', 'Champiñones enlatados', 24, 32, 10, 35],
        ['Atún Dolores en Agua 140g', 'Atún en agua', 22, 30, 15, 50],
        ['Atún Dolores en Aceite 140g', 'Atún en aceite', 24, 32, 15, 50],
        ['Atún Herdez en Agua 140g', 'Atún en agua', 24, 32, 15, 50],
        ['Sardinas 120g', 'Sardinas en salsa de tomate', 16, 22, 15, 50],
        ['Chilorio 300g', 'Carne de cerdo deshebrada', 55, 75, 6, 20],
        ['Cochinita Pibil 300g', 'Carne de cerdo adobada', 55, 75, 6, 20],
        ['Sopa de Pollo Knorr', 'Consomé de pollo', 10, 14, 25, 100],
        ['Sopa de Res Knorr', 'Consomé de res', 10, 14, 25, 100],
        ['Sopa de Tomate Knorr', 'Consomé de tomate', 10, 14, 25, 100],
        ['Caldo de Pollo 1kg', 'Caldo de pollo en polvo', 35, 48, 10, 35],
        ['Consomé de Pollo 500g', 'Consomé en polvo', 22, 30, 12, 40],
        ['Avena Quaker 350g', 'Avena en hojuelas', 28, 38, 15, 50],
        ['Avena Quaker Instantánea 400g', 'Avena instantánea', 32, 42, 15, 50],
        ['Cereal Corn Flakes 510g', 'Cereal de maíz', 45, 60, 10, 35],
        ['Cereal Zucaritas 420g', 'Cereal azucarado', 48, 65, 10, 35],
        ['Cereal Froot Loops 410g', 'Cereal de frutas', 50, 68, 10, 35],
        ['Cereal Cheerios 340g', 'Cereal de avena', 45, 60, 10, 35],
        ['Miel de Abeja 250g', 'Miel natural', 45, 60, 8, 25],
        ['Mermelada de Fresa 270g', 'Mermelada', 28, 38, 10, 35],
        ['Mermelada de Uva 270g', 'Mermelada', 28, 38, 10, 35],
        ['Mermelada de Durazno 270g', 'Mermelada', 28, 38, 10, 35],
        ['Cajeta Coronado 370g', 'Cajeta de celaya', 38, 52, 10, 35],
        ['Cajeta Real 280g', 'Cajeta de celaya', 32, 44, 10, 35],
        ['Chocolate Abuelita Tableta 90g', 'Chocolate para mesa', 18, 25, 20, 80],
        ['Chocolate Ibarra Tableta 90g', 'Chocolate para mesa', 20, 28, 20, 80],
        ['Cocoa 250g', 'Cocoa en polvo', 35, 48, 10, 35],
        ['Leche Condensada La Lechera 397g', 'Leche condensada', 32, 44, 12, 40],
        ['Leche Evaporada Carnation 360g', 'Leche evaporada', 28, 38, 12, 40],
        ['Media Crema 225g', 'Media crema', 22, 30, 12, 40],
        ['Crema Ácida 450g', 'Crema ácida', 32, 44, 10, 35],
        ['Huevo Blanco 1kg', 'Huevo fresco', 42, 55, 20, 80],
        ['Huevo Rojo 1kg', 'Huevo fresco', 44, 58, 20, 80],
        ['Tortilla de Maíz 1kg', 'Tortillas frescas', 18, 24, 30, 120],
        ['Tortilla de Harina 10 pzas', 'Tortillas de harina', 22, 30, 20, 80],
        ['Pan Bimbo Blanco Grande', 'Pan de caja', 38, 52, 15, 60],
        ['Pan Bimbo Integral', 'Pan integral de caja', 42, 56, 12, 50],
        ['Pan Bimbo Hot Dog', 'Pan para hot dog', 28, 38, 12, 50],
        ['Pan Bimbo Hamburguesa', 'Pan para hamburguesa', 30, 40, 12, 50],
        ['Bolillo 4 pzas', 'Pan francés', 10, 14, 30, 120],
        ['Telera 4 pzas', 'Pan para tortas', 12, 16, 25, 100],
        ['Croissant', 'Panecillo de mantequilla', 14, 18, 15, 60],
        ['Donas Bimbo 4 pzas', 'Donas glaseadas', 28, 38, 12, 50],
        ['Mantecadas 6 pzas', 'Mantecadas individuales', 22, 30, 15, 60],
        ['Panque Nativo', 'Panqué', 32, 44, 10, 35],
        ['Gelatina D\'Gari Fresa', 'Gelatina en polvo', 12, 16, 20, 80],
        ['Gelatina D\'Gari Uva', 'Gelatina en polvo', 12, 16, 20, 80],
        ['Flan Jell-O Vainilla', 'Flan en polvo', 18, 25, 15, 60],
        ['Flan Jell-O Caramelo', 'Flan en polvo', 18, 25, 15, 60],
        ['Gelatina Jell-O Limón', 'Gelatina en polvo', 16, 22, 15, 60],
        ['Puré de Papa 200g', 'Puré de papa instantáneo', 18, 25, 12, 40],
        ['Sopa Instantánea Maruchan Pollo', 'Sopa instantánea', 14, 18, 30, 120],
        ['Sopa Instantánea Maruchan Camarón', 'Sopa instantánea', 14, 18, 30, 120],
        ['Sopa Instantánea Maruchan Res', 'Sopa instantánea', 14, 18, 30, 120],
        ['Sopa Instantánea Nissin Pollo', 'Sopa instantánea', 12, 16, 30, 120],
        ['Sopa Instantánea Nissin Camarón', 'Sopa instantánea', 12, 16, 30, 120],
        ['Salsa para Pasta Bolognesa 500g', 'Salsa lista para pasta', 35, 48, 10, 35],
        ['Salsa Alfredo 500g', 'Salsa alfredo lista', 38, 52, 8, 25],
        ['Chile Guajillo 100g', 'Chile seco', 18, 25, 10, 35],
        ['Chile Ancho 100g', 'Chile seco', 18, 25, 10, 35],
        ['Chile Pasilla 100g', 'Chile seco', 18, 25, 10, 35],
        ['Chile de Árbol 100g', 'Chile seco picante', 16, 22, 10, 35],
        ['Chile Morita 100g', 'Chile seco ahumado', 22, 30, 8, 25],
        ['Comino Molido 40g', 'Especia molida', 14, 20, 15, 50],
        ['Orégano 30g', 'Especia seca', 12, 18, 15, 50],
        ['Pimienta Negra Molida 40g', 'Especia molida', 18, 25, 15, 50],
        ['Canela Molida 30g', 'Especia molida', 12, 18, 15, 50],
        ['Ajo en Polvo 60g', 'Ajo deshidratado molido', 16, 22, 15, 50],
        ['Cebolla en Polvo 60g', 'Cebolla deshidratada molida', 16, 22, 15, 50],
        ['Paprika 40g', 'Pimentón dulce molido', 18, 25, 12, 40],
        ['Consomé de Pollo en Cubos 120g', 'Cubos de consomé', 18, 25, 15, 50],
        ['Caldo de Pollo en Cubos 110g', 'Cubos de caldo', 18, 25, 15, 50],
        ['Sazonador Goya con Azafrán', 'Sazonador', 16, 22, 15, 50],
        ['Sazonador Tajín Clásico 142g', 'Sazonador picante', 32, 44, 15, 50],
        ['Sazonador Tajín Chamoy 160g', 'Sazonador sabor chamoy', 35, 48, 10, 35],
        ['Sal con Ajo 120g', 'Sal sazonada', 16, 22, 15, 50],
        ['Pimienta Blanca Molida 40g', 'Especia molida', 22, 30, 10, 35],
    ],
    4 => [ // Lácteos
        ['Leche Entera 1L', 'Leche pasteurizada entera', 21, 27, 30, 100],
        ['Leche Light 1L', 'Leche pasteurizada light', 22, 28, 25, 80],
        ['Leche Deslactosada 1L', 'Leche deslactosada', 24, 32, 25, 80],
        ['Leche de Almendras 1L', 'Leche vegetal de almendra', 45, 60, 8, 25],
        ['Leche de Soya 1L', 'Leche vegetal de soya', 35, 48, 10, 35],
        ['Leche de Avena 1L', 'Leche vegetal de avena', 42, 56, 8, 25],
        ['Yogurt Natural 1kg', 'Yogurt natural sin azúcar', 48, 65, 8, 25],
        ['Yogurt Natural 500g', 'Yogurt natural sin azúcar', 28, 38, 10, 35],
        ['Yogurt con Frutas Fresa 150g', 'Yogurt con fresa', 12, 16, 25, 100],
        ['Yogurt con Frutas Durazno 150g', 'Yogurt con durazno', 12, 16, 25, 100],
        ['Yogurt con Frutas Moras 150g', 'Yogurt con moras', 12, 16, 25, 100],
        ['Yogurt Bebible Fresa 330ml', 'Yogurt para beber', 14, 18, 20, 80],
        ['Yogurt Bebible Durazno 330ml', 'Yogurt para beber', 14, 18, 20, 80],
        ['Yogurt Bebible Natural 330ml', 'Yogurt para beber', 13, 17, 20, 80],
        ['Yogurt Griego Natural 150g', 'Yogurt griego', 22, 30, 12, 40],
        ['Yogurt Griego Fresa 150g', 'Yogurt griego con fresa', 24, 32, 12, 40],
        ['Danonino Fresa 6 pzas', 'Yogurt para niños', 32, 44, 12, 40],
        ['Danonino Vainilla 6 pzas', 'Yogurt para niños', 32, 44, 12, 40],
        ['Queso Fresco 400g', 'Queso fresco', 42, 56, 10, 35],
        ['Queso Oaxaca 400g', 'Queso oaxaca', 65, 85, 8, 25],
        ['Queso Panela 400g', 'Queso panela', 48, 65, 10, 35],
        ['Queso Manchego 400g', 'Queso manchego', 95, 130, 5, 20],
        ['Queso Cheddar 400g', 'Queso cheddar', 75, 100, 6, 20],
        ['Queso Amarillo Rebanado 400g', 'Queso americano rebanado', 55, 75, 8, 25],
        ['Queso Crema Philadelphia 190g', 'Queso crema', 42, 56, 12, 40],
        ['Queso Crema Philadelphia 350g', 'Queso crema grande', 72, 95, 8, 25],
        ['Mantequilla Primavera 90g', 'Mantequilla con sal', 22, 30, 15, 50],
        ['Mantequilla Primavera 225g', 'Mantequilla con sal', 42, 56, 10, 35],
        ['Mantequilla Sin Sal 90g', 'Mantequilla sin sal', 24, 32, 12, 40],
        ['Margarina Inca 90g', 'Margarina', 12, 16, 20, 80],
        ['Margarina Inca 400g', 'Margarina grande', 32, 44, 10, 35],
        ['Crema 450g', 'Crema para batir', 35, 48, 10, 35],
        ['Crema Ligera 450g', 'Crema ligera', 32, 44, 10, 35],
        ['Jocoque 450g', 'Jocoque natural', 38, 52, 8, 25],
        ['Requesón 400g', 'Requesón fresco', 32, 44, 8, 25],
        ['Ricotta 250g', 'Queso ricotta', 48, 65, 5, 15],
        ['Queso Parmesano Rallado 100g', 'Queso parmesano rallado', 45, 60, 8, 25],
        ['Queso Mozzarella Rallada 200g', 'Queso mozzarella rallado', 55, 75, 8, 25],
        ['Queso Cotija 250g', 'Queso cotija', 42, 56, 8, 25],
        ['Queso Crema para Untar Cebolla', 'Queso crema sabor cebolla', 45, 60, 6, 20],
        ['Yogurt Probiótico Natural', 'Yogurt con probióticos', 18, 25, 12, 40],
        ['Kéfir Natural 500ml', 'Kéfir fermentado', 38, 52, 5, 15],
        ['Kéfir Fresa 500ml', 'Kéfir fermentado', 40, 55, 5, 15],
        ['Leche en Polvo 400g', 'Leche en polvo', 75, 100, 6, 20],
        ['Leche en Polvo 800g', 'Leche en polvo grande', 140, 180, 4, 12],
        ['Chocolate Lácteo 500g', 'Leche sabor chocolate', 28, 38, 10, 35],
        ['Malteada de Chocolate 330ml', 'Bebida láctea', 16, 22, 12, 40],
        ['Malteada de Fresa 330ml', 'Bebida láctea', 16, 22, 12, 40],
        ['Malteada de Vainilla 330ml', 'Bebida láctea', 16, 22, 12, 40],
        ['Nata 450g', 'Nata para cocinar', 28, 38, 8, 25],
        ['Helado Napolitano 1L', 'Helado sabor napolitano', 65, 85, 5, 20],
        ['Helado de Vainilla 1L', 'Helado de vainilla', 60, 80, 5, 20],
        ['Helado de Fresa 1L', 'Helado de fresa', 60, 80, 5, 20],
        ['Helado de Chocolate 1L', 'Helado de chocolate', 60, 80, 5, 20],
        ['Helado de Limón 1L', 'Helado de limón', 55, 75, 5, 20],
        ['Paletas de Hielo Frutales 6 pzas', 'Paletas de hielo', 45, 60, 8, 25],
        ['Paletas de Hielo Crema 4 pzas', 'Paletas de hielo con crema', 55, 75, 6, 20],
        ['Helado Sundae Chocolate', 'Helado en cono', 25, 35, 10, 35],
        ['Helado Sundae Fresa', 'Helado en cono', 25, 35, 10, 35],
    ],
];

function randomPrice(float $min, float $max): float {
    return round($min + mt_rand() / mt_getrandmax() * ($max - $min), 2);
}

function randomInt(int $min, int $max): int {
    return mt_rand($min, $max);
}

try {
    $db = new Database();

    // Validar que exista la tienda
    $store = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ?', [$storeId]);
    if (!$store) {
        throw new Exception("No existe la tienda con ID {$storeId}");
    }

    // Validar que exista el usuario admin
    $user = $db->selectOne('SELECT user_id FROM users WHERE user_id = ?', [$userId]);
    if (!$user) {
        throw new Exception("No existe el usuario con ID {$userId}");
    }

    // Validar categorías
    $catIds = array_keys($categories);
    $placeholders = implode(',', array_fill(0, count($catIds), '?'));
    $existingCats = $db->select("SELECT category_id FROM categories WHERE category_id IN ({$placeholders})", $catIds);
    $existingCatIds = array_column($existingCats, 'category_id');
    $missingCats = array_diff($catIds, $existingCatIds);
    if ($missingCats) {
        throw new Exception('Faltan categorías: ' . implode(', ', $missingCats));
    }

    // Obtener barcodes existentes para evitar duplicados
    $existingBarcodes = array_column(
        $db->select('SELECT barcode FROM products WHERE store_id = ? AND barcode IS NOT NULL', [$storeId]),
        'barcode'
    );
    $existingBarcodes = array_flip($existingBarcodes);

    $db->beginTransaction();

    $inserted = 0;
    $skipped = 0;
    $baseBarcode = 7501000000000;

    foreach ($productsByCategory as $categoryId => $items) {
        foreach ($items as $item) {
            [$name, $description, $priceMin, $priceMax, $stockMin, $stockMax] = $item;

            // Generar barcode único
            do {
                $barcode = (string)($baseBarcode + $inserted + $skipped);
                if (isset($existingBarcodes[$barcode])) {
                    $skipped++;
                } else {
                    break;
                }
            } while (true);

            $price = randomPrice($priceMin, $priceMax);
            $cost = round($price * randomPrice(0.55, 0.80), 2);
            $stock = randomInt($stockMin, $stockMax);
            $minStock = (int)max(5, round($stock * 0.2));

            $productId = $db->insert(
                'INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, current_stock, min_stock, status, is_bulk, bulk_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
                [$storeId, $categoryId, $name, $description, $barcode, $price, $cost, $stock, $minStock, 'active', 0, 'kg']
            );

            if ($stock > 0) {
                $db->insert(
                    'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?, ?, ?, "adjustment", ?, 0, ?, "Stock inicial (seed)", NOW())',
                    [$storeId, $productId, $userId, $stock, $stock]
                );
            }

            $existingBarcodes[$barcode] = true;
            $inserted++;

            if ($inserted % 50 === 0) {
                echo "  ... {$inserted} productos insertados\n";
            }
        }
    }

    $db->commit();

    echo "\n✅ Seed completado.\n";
    echo "Productos insertados: {$inserted}\n";
    echo "Total de productos en tienda {$storeId}: " . $db->selectOne('SELECT COUNT(*) AS c FROM products WHERE store_id = ?', [$storeId])['c'] . "\n";

} catch (Exception $e) {
    if (isset($db)) {
        $db->rollback();
    }
    echo "\n❌ Error: " . $e->getMessage() . "\n";
    exit(1);
}
