// API for e.g. Mobile application
// This API uses the website

exports.install = function () {
    // COMMON
    F.route('/api/ping/', json_ping);

    // ORDERS
    F.route('/api/checkout/create/', json_orders_create, ['post', '*Order']);
    F.route('/api/checkout/{id}/', json_orders_read, ['*Order']);

    // USERS
    F.route('/api/users/create/', json_users, ['post', '*UserRegistration']);
    F.route('/api/users/password/', json_users, ['post', '*UserPassword']);
    F.route('/api/users/login/', json_users, ['post', '*UserLogin']);
    F.route('/api/users/settings/', json_users_settings, ['put', '*UserSettings', 'authorize']);

    // PRODUCTS
    F.route('/api/products/', json_products_query, ['*Product']);
    F.route('/api/products/{id}/', json_products_read, ['*Product']);
    F.route('/api/products/categories/', json_products_categories);

    // NEWSLETTER
    F.route('/api/newsletter/', json_save, ['post', '*Newsletter']);

    // CONTACTFORM
    F.route('/api/contact/', json_save, ['post', '*Contact']);

    // CART
    var cart = new Cart();
    F.route('/api/cart/', cart.readAndUpdate, ['unauthorize', 'json', 'put']);
    F.route('/api/cart/', cart.readAndUpdate, ['authorize', 'json', 'put']);
    F.route('/api/price/', cart.priceOrAddCart, ['unauthorize', 'json', 'post']);
    F.route('/api/price/', cart.priceOrAddCart, ['authorize', 'json', 'post']);
    F.route('/api/cart/{id}', cart.deleteItem, ['delete']);
};

// ==========================================================================
// COMMON
// ==========================================================================

function json_ping() {
    var self = this;
    self.plain('null');
}

// ==========================================================================
// CARTS
// ==========================================================================

function Cart() {
}

Cart.prototype = {
    priceOrAddCart: function () { //id is product._id
        var self = this;

        var price_level = null;
        console.log(self.body);

        var userId = null;

        if (self.user)
            userId = self.user._id;

        if (self.user && self.user.societe && self.user.societe.price_level)
            price_level = self.user.societe.price_level;

        var ProductModel = MODEL('product').Schema;

        if (!self.body.save) // Just a price from a quantity and a price_level
            return ProductModel.findPrice({_id: self.body.product, qty: self.body.qty, price_level: price_level}, function (err, doc) {
                if (err)
                    return console.log(err);
                self.json(doc);
            });

        //Add to card
        var CartModel = MODEL('cart').Schema;

        // Already in cart
        if (self.body.optional && self.body.optional.cartId) {
            var query = {_id: self.body.optional.cartId};

            if (self.body.qty <= 0)
                return CartModel.remove(query, function (err, doc) {
                    self.json({});
                });


            var data = {
                count: self.body.qty, //qty
                discount: 0,
                blocked: false, //Price was negociate and blocked
                optional: self.body.optional,
                updatedAt: new Date
            };

            return CartModel.update(query, {$set: data}, {upsert: false}, function (err, doc) {
                self.json(doc);
            });
        }

        //Add new in cart
        var data = {
            product: self.body.product,
            entity: self.query.entity,
            count: self.body.qty, //qty
            userId: userId,
            discount: 0,
            blocked: false, //Price was negociate and blocked
            optional: self.body.optional
        };

        var cart = new CartModel(data);
        cart.optional.cartId = cart._id;

        cart.save(function (err, doc) {
            if (err)
                return console.log(err);

            self.json(doc);
        });
    },
    readAndUpdate: function () { //id is product._id
        var self = this;

        //console.log(self.user);
        console.log("auth cart");
        var price_level = null;
        var userId = null;

        if (self.user)
            userId = self.user._id;

        if (self.user && self.user.societe && self.user.societe.price_level)
            price_level = self.user.societe.price_level;

        var CartModel = MODEL('cart').Schema;

        console.log("body", self.body);

        // Fusion old cart + new cart from body

        var query = {};

        if (userId)
            query = {
                $or: [
                    {userId: userId},
                    {_id: {$in: self.body}}
                ]
            };
        else
            query = {_id: {$in: self.body}};

        if (self.query.entity)
            query.entity = self.query.entity;

        CartModel.find(query, "", {sort: {_id: 1}}, function (err, cart) {

            /* });
             
             async.each(self.body, function (line, callback) {
             
             var query = {userId: self.user._id,
             product: line.id};
             if (self.query.entity)
             query.entity = self.query.entity;
             
             var data = {
             count: line.count, //qty
             discount: 0,
             blocked: false, //Price was negociate and blocked
             price: line.price, //Price unit
             optional: line.optional,
             updatedAt: new Date
             };
             CartModel.update(query, {$set: data}, {upsert: true}, function (err, doc) {
             callback();
             });
             }, function (err) {
             
             var query = {userId: self.user._id};
             if (self.query.entity)
             query.entity = self.query.entity;
             
             CartModel.find(query, function (err, cart) {*/

            var res = _.map(cart, function (elem) {
                var data = {
                    id: elem.product,
                    count: elem.count,
                    price: elem.price,
                    optional: elem.optional
                };

                data.optional.cartId = elem._id;

                return (data);
            });

            return _calculCart(res, price_level, function (data) {
                //console.log(data);

                async.each(data, function (elem, cb) {
                    //console.log("elem", elem);

                    var query = {_id: elem.optional.cartId};

                    var update = {
                        price: elem.price,
                        discount: elem.discount || 0
                    };

                    if (userId)
                        update.userId = userId;

                    //Refresh price
                    CartModel.update(query, {$set: update}, {upsert: false}, function (err, doc) {
                        if (err)
                            console.log(err);
                        cb();
                    });
                }, function (err) {

                    self.json(data);
                });
            });
        });
        //});
    },
    deleteItem: function (id) {
        var self = this;
        var CartModel = MODEL('cart').Schema;

        CartModel.remove({_id: id}, function (err, doc) {
            if (err)
                console.log(err);

            return self.json({});
        });
    }
};

//Update cart price from qty and pricelevel
function _calculCart(arr, price_level, callback) {

    if (!arr.length)
        return callback([]);

    var ProductModel = MODEL('product').Schema;

    async.map(arr, function (elem, cb) {
        ProductModel.findOne({_id: elem.id}, "prices discount label linker files category type dynForm")
                .populate('category', "_id path url linker name")
                .exec(function (err, item) {
                    if (err)
                        return cb(err);

                    var data = {
                        id: item._id,
                        name: item.label,
                        price: 0,
                        count: elem.count,
                        optional: elem.optional,
                        product: {id: item._id, dynForm: item.dynForm},
                        files: (item.files[0] ? item.files[0] : null)
                                //reference: item.reference
                    };



                    // Dynamic Product
                    if (item.type === 'DYNAMIC') {
                        var DynFormModel = MODEL('dynform').Schema;
                        //console.log(self.body);
                        //console.log(price_level);

                        return DynFormModel.findOne({
                            name: item.dynForm
                        }, "combined", function (err, dynform) {

                            async.waterfall(dynform.combined(data, price_level || 'BASE'), function (err, result) {
                                if (err)
                                    console.log(err);

                                //console.log(result);

                                data.price = data.pu_ht;

                                var linker_detail = F.sitemap('detail', true);
                                var linker_category = F.sitemap('category', true);

                                if (linker_detail) {
                                    data.url = item.linker;
                                    data.linker = linker_detail.url.format(item.linker, item._id);
                                }
                                if (linker_category)
                                    data.linker_category = linker_category.url + item.category.linker + '/' + item.category._id + '/';

                                cb(null, data);

                            });
                        });
                    }

                    item.getPrice(elem.count, price_level).then(function (price) {
                        data.price = price;

                        var linker_detail = F.sitemap('detail', true);
                        var linker_category = F.sitemap('category', true);

                        if (linker_detail) {
                            data.url = item.linker;
                            data.linker = linker_detail.url.format(item.linker, item._id);
                        }
                        if (linker_category)
                            data.linker_category = linker_category.url + item.category.linker + '/' + item.category._id + '/';

                        cb(null, data);
                    });

                });
    }, function (err, results) {
        if (err) {
            console.log(err);
            return callback([]);
        }
        callback(results);
    });

}


// ==========================================================================
// PRODUCTS
// ==========================================================================

// Reads product categories
function json_products_categories() {
    var self = this;

    if (!F.global.categories)
        F.global.categories = [];

    self.json(F.global.categories);
}

// Reads products
function json_products_query() {
    var self = this;

    // Renders related products
    if (self.query.html) {
        // Disables layout
        self.layout('');
        self.$query(self.query, self.callback('~eshop/partial-products'));
        return;
    }

    self.$query(self.query, self.callback());
}

// Reads a specific product
function json_products_read(id) {
    var self = this;
    var options = {};
    options.id = id;
    self.$get(options, self.callback());
}

// Reads all product categories
function json_products_categories() {
    var self = this;

    if (!F.global.categories)
        F.global.categories = [];

    self.json(F.global.categories);
}

// ==========================================================================
// ORDERS
// ==========================================================================

// Creates a new order
function json_orders_create() {
    var self = this;
    self.body.ip = self.ip;
    self.body.language = self.language;
    self.body.iduser = self.user ? self.user.id : '';
    self.body.$workflow('create', self.callback());
}

// Reads a specific order
function json_orders_read(id) {
    var self = this;
    var options = {};
    options.id = id;
    self.$get(options, self.callback());
}

// ==========================================================================
// USERS
// ==========================================================================

function json_users() {
    var self = this;
    var options = {};

    options.controller = self;
    options.ip = self.ip;

    self.body.$workflow('exec', options, self.callback());
}

function json_users_settings() {
    var self = this;
    var options = {};
    options.controller = self;
    self.body.id = self.user.id;
    self.body.$save(options, self.callback());
}

// ==========================================================================
// NEWSLETTER & CONTACTFORM
// ==========================================================================

// Appends a new email into the newsletter list
function json_save() {
    var self = this;
    self.body.$save(self.callback());
}