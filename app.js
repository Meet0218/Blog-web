require("dotenv").config();
require("./database/conn");
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const _ = require("lodash");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const findOrCreate = require("mongoose-findorcreate");
const LocalStrategy = require("passport-local").Strategy;

const app = express();

app.use(
  session({
    secret: "little secret",
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({ mongoUrl: process.env.DATABASE }),
    cookie: { maxAge: 3600000 },
  })
);

app.use(passport.initialize());
app.use(passport.session());

/// plugin for passportLocalMongoose

app.set("view engine", "ejs");
mongoose.set("strictQuery", false);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Define user schema
const userSchema = new mongoose.Schema({
  name: String,
  username: String,
  email: String,
  password: String,
  googleId: String,
  profileImg: String,
  posts: [{ title: String, content: String }],
});

userSchema.plugin(passportLocalMongoose);
/// plugin for findorcreate-mongoose
userSchema.plugin(findOrCreate);
const User = mongoose.model("User", userSchema);

/// passport serialize and deserialize cookies
passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id)
    .exec()
    .then((user) => {
      done(null, user);
    })
    .catch((err) => {
      done(err, null);
    });
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/blog",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      scope: ["profile"],
    },
    function (accessToken, refreshToken, profile, cb) {
      // console.log(profile);

      User.findOrCreate(
        {
          googleId: profile.id,
          name: profile.displayName,
          profileImg: profile._json.picture,
        },
        function (err, user) {
          return cb(err, user);
        }
      );
    }
  )
);

const homeStartingContent =
  "Welcome to our blog platform! Here you can find a diverse range of content contributed by our community of users. Whether you're interested in technology, travel, food, or anything in between, you'll discover captivating stories, insightful reflections, and helpful tips. Take a moment to explore the latest posts and be inspired by the experiences shared by our vibrant community. If you have a story to tell or knowledge to share, feel free to join us and start contributing today!";
const aboutContent =
  "Hac habitasse platea dictumst vestibulum rhoncus est pellentesque. Dictumst vestibulum rhoncus est pellentesque elit ullamcorper. Non diam phasellus vestibulum lorem sed. Platea dictumst quisque sagittis purus sit. Egestas sed sed risus pretium quam vulputate dignissim suspendisse. Mauris in aliquam sem fringilla. Semper risus in hendrerit gravida rutrum quisque non tellus orci. Amet massa vitae tortor condimentum lacinia quis vel eros. Enim ut tellus elementum sagittis vitae. Mauris ultrices eros in cursus turpis massa tincidunt dui.";
const contactContent =
  "Scelerisque eleifend donec pretium vulputate sapien. Rhoncus urna neque viverra justo nec ultrices. Arcu dui vivamus arcu felis bibendum. Consectetur adipiscing elit duis tristique. Risus viverra adipiscing at in tellus integer feugiat. Sapien nec sagittis aliquam malesuada bibendum arcu vitae. Consequat interdum varius sit amet mattis. Iaculis nunc sed augue lacus. Interdum posuere lorem ipsum dolor sit amet consectetur adipiscing elit. Pulvinar elementum integer enim neque. Ultrices gravida dictum fusce ut placerat orci nulla. Mauris in aliquam sem fringilla ut morbi tincidunt. Tortor posuere ac ut consequat semper viverra nam libero.";

// Middleware to check if user is authenticated
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

/// authenticate user from google
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile"] })
);

app.get(
  "/auth/google/blog",
  passport.authenticate("google", { failureRedirect: "/login" }),
  function (req, res) {
    res.redirect("/");
  }
);

// Assuming you have configured Passport.js for local authentication
app.get("/", async function (req, res) {
  try {
    const allUsersWithPosts = await User.find({});

    let allPosts = [];
    allUsersWithPosts.forEach((user) => {
      user.posts.forEach((post) => {
        post.userName = user.name;
        post.profileImg = user.profileImg;
        allPosts.push(post);
      });
    });

    allPosts.sort((a, b) => b._id.getTimestamp() - a._id.getTimestamp());

    res.render("home", {
      startingContent: homeStartingContent,
      posts: allPosts,
    });
  } catch (err) {
    console.log(err);
    res.render({ errorMessage: "Failed to fetch posts" });
  }
});

app.get("/register", function (req, res) {
  res.render("register");
});

app.get("/login", function (req, res) {
  res.render("login");
});

// Assuming you have a route for the profile page
app.get("/profile", function (req, res) {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  const userId = req.session.passport.user;

  // Find the user's posts from the database
  User.findById(userId)
    .then((user) => {
      if (!user) {
        console.log("User not found");
        return res.redirect("/");
      }

      console.log("User coming from profile route: " + user);

      res.render("profile", {
        name: user.name,
        username: user.username,
        profileImg: user.profileImg,
        posts: user.posts,
      });
    })
    .catch((err) => {
      console.error(err);
      res.status(500).send("Internal Server Error");
    });
});

app.get("/about", function (req, res) {
  res.render("about", { aboutContent: aboutContent });
});

app.get("/contact", function (req, res) {
  res.render("contact", { contactContent: contactContent });
});

app.get("/posts/:id", isLoggedIn, async function (req, res) {
  const requestedTitle = _.lowerCase(req.params.id);
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.redirect("/");
    }

    // Find the requested post by title
    const post = user.posts.find(
      (post) => _.lowerCase(post.title) === requestedTitle
    );
    if (post) {
      // Render the post template with the post details
      res.render("post", {
        newPostTitle: post.title,
        newPostContent: post.content,
        post: post,
      });
    } else {
      console.log("Post not found from post/:id");
      res.redirect("/");
    }
  } catch (err) {
    console.log(err);
    res.redirect("/");
  }
});

// POST route to handle deletion of a post
app.post(
  "/posts/:postId/delete",
  passport.authenticate("local", { session: false }),
  async function (req, res) {
    const postId = req.params.postId;

    try {
      const user = await User.findById(req.session.userId);
      if (!user) {
        console.log("User not found");
        return res.redirect("/");
      }

      // Find the post to be deleted
      const postToDelete = user.posts.find(
        (post) => post._id.toString() === postId
      );
      if (!postToDelete) {
        console.log("Post not found");
        return res.redirect("/");
      }

      // Check if the post belongs to the current user
      if (
        !postToDelete.user || // Assuming postToDelete.user is the creator's ID
        postToDelete.user.toString() !== req.session.userId
      ) {
        console.log("User is not authorized to delete this post");
        return res.redirect("/");
      }

      // Remove the post from the user's posts array
      user.posts = user.posts.filter((post) => post._id.toString() !== postId);
      await user.save();
      console.log("Post deleted successfully");
      res.redirect("/");
    } catch (err) {
      console.log(err);
      res.redirect("/");
    }
  }
);

app.get("/compose", isLoggedIn, function (req, res) {
  res.render("compose");
});

// Post request to register user in DB
app.post("/register", async function (req, res, next) {
  try {
    const { name, username, password } = req.body;
    const user = new User({ name: name, username: username });

    await User.register(user, password);

    // Log in the newly registered user
    req.login(user, function (err) {
      if (err) {
        console.error("Error logging in user:", err);
        return next(err);
      }
      res.redirect("/");
    });
  } catch (err) {
    console.error("Error registering user:", err);
    res.redirect("/register");
  }
});

// New login post request
app.post("/login", function (req, res, next) {
  const { username, password } = req.body;

  console.log(req.body);
  if (!username || !password) {
    return res.redirect("/login?error=missing_credentials");
  }

  passport.authenticate("local", function (err, user, info) {
    if (err) {
      return next(err);
    }
    console.log("login user: " + user);
    if (!user) {
      return res.redirect("/login?error=invalid_credentials");
    }
    req.logIn(user, function (err) {
      if (err) {
        return next(err);
      }
      return res.redirect("/");
    });
  })(req, res, next);
});

app.post("/logout", function (req, res) {
  req.logout(function (err) {
    if (err) {
      console.error(err);
    }
    res.redirect("/");
  });
});

// Compose a new blog post and save it to the database
app.post("/compose", isLoggedIn, function (req, res) {
  const newPost = {
    title: req.body.postTitle,
    content: req.body.postBody,
  };
  User.findById(req.user._id)
    .then((foundUser) => {
      if (!foundUser) {
        console.log("User not found");
        return res.redirect("/");
      }
      foundUser.posts.push(newPost);
      return foundUser.save();
    })
    .then(() => {
      console.log("Post added successfully");
      res.redirect("/");
    })
    .catch((err) => {
      console.error(err);
      res.redirect("/");
    });
});

app.listen(3000, function () {
  console.log("Server started on port 3000");
});
