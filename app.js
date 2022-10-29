const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const addNamesToList = (eachName) => eachName.name;

const authenticatePersonTweet = async (request, response, next) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getUserTweet = `select * from tweet INNER JOIN user ON tweet.user_id = user.user_id where user.username = '${username}' AND tweet.tweet_id = ${tweetId};`;
  const userTweet = await db.get(getUserTweet);
  if (userTweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    request.userTweet = userTweet;
    next();
  }
};

const authenticateTweet = async (request, response, next) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getUserIdQuery = `select user_id from user where username = '${username}';`;
  const userId = await db.get(getUserIdQuery);
  const getUserTweet = `
  SELECT * 
  FROM
   follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id
  WHERE 
   follower.follower_user_id = ${userId.user_id} AND tweet.tweet_id = ${tweetId};`;
  const userTweet = await db.get(getUserTweet);
  if (userTweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    request.tweetQuery = userTweet;
    next();
  }
};

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}

//User register API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `select * from user where username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
            INSERT INTO 
               user(username,password,name,gender)
            VALUES(
                '${username}','${hashedPassword}','${name}','${gender}'
            );`;
      await db.run(createUserQuery);
      response.send("User created successfully");
    }
  }
});

//User Loin API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await db.get(selectUserQuery);
  if (databaseUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      databaseUser.password
    ); //comparing password
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN"); //generating jwt Token
      response.send({ jwtToken });
      console.log(jwtToken);
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//Get latest tweets API
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `select user_id from user where username = '${username}';`;
  const userId = await db.get(getUserIdQuery);
  const getTweetsQuery = `
   SELECT
    username AS username,
    tweet.tweet AS tweet,
    tweet.date_time as dateTime
   FROM
     (follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id) AS T INNER JOIN user ON T.user_id = user.user_id
   WHERE
     follower.follower_user_id = ${userId.user_id}
    ORDER BY
     dateTime DESC
      LIMIT 4;`;
  const tweetsArray = await db.all(getTweetsQuery);
  response.send(tweetsArray);
});

//Get following list API
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `select user_id from user where username = '${username}';`;
  const userId = await db.get(getUserIdQuery);
  const getFollowingQuery = `
   SELECT 
     user.name AS name
   FROM 
    follower INNER JOIN user ON follower.following_user_id = user.user_id
   WHERE 
    follower.follower_user_id = ${userId.user_id};`;
  const followingArray = await db.all(getFollowingQuery);
  response.send(followingArray);
});

//Get followers list API
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `select user_id from user where username = '${username}';`;
  const userId = await db.get(getUserIdQuery);
  const getFollowersQuery = `
   SELECT 
     user.name AS name
   FROM 
    follower INNER JOIN user ON follower.follower_user_id = user.user_id
   WHERE 
    follower.following_user_id = ${userId.user_id};`;
  const followersArray = await db.all(getFollowersQuery);
  response.send(followersArray);
});

//get tweets API
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  authenticateTweet,
  async (request, response) => {
    const { tweetQuery } = request;
    // console.log(tweetQuery);
    // response.send(tweetQuery);
    const getTweetDetailsQuery = `
      SELECT 
       tweet.tweet AS tweet,
       COUNT(like_id) AS likes,
       COUNT(reply_id) AS replies,
       tweet.date_time AS dateTime
      FROM 
      (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) AS T LEFT JOIN reply ON T.tweet_id = reply.tweet_id
      WHERE
      tweet.tweet_id = ${tweetQuery.tweet_id};`;
    const tweet = await db.get(getTweetDetailsQuery);
    response.send(tweet);
  }
);

//GET likedPerson API
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  authenticateTweet,
  async (request, response) => {
    const { tweetQuery } = request;
    const getLikedPersonQuery = `
    SELECT 
      user.username AS name
    FROM
     like INNER JOIN user ON like.user_id = user.user_id
    WHERE 
     like.tweet_id = ${tweetQuery.tweet_id};`;
    const likes = await db.all(getLikedPersonQuery);
    const likesList = likes.map((eachName) => addNamesToList(eachName));
    response.send({ likes: likesList });
  }
);

//GET replies API
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  authenticateTweet,
  async (request, response) => {
    const { tweetQuery } = request;
    const getRepliesQuery = `
    SELECT 
      user.name AS name,
      reply.reply AS reply
    FROM
      reply INNER JOIN user ON  reply.user_id = user.user_id
    WHERE
      reply.tweet_id = ${tweetQuery.tweet_id};`;
    const replies = await db.all(getRepliesQuery);
    response.send({ replies: replies });
  }
);

//Get tweets API
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `select user_id from user where username = '${username}';`;
  const userId = await db.get(getUserIdQuery);
  const getTweetsQuery = `
  SELECT 
    tweet.tweet AS tweet,
    COUNT(like.user_id) AS likes,
    COUNT(reply.reply) AS replies,
    tweet.date_time AS dateTime
  FROM
    (tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id)
     AS T LEFT JOIN like ON T.tweet_id = like.tweet_id
  WHERE
    tweet.user_id = ${userId.user_id}
    GROUP BY
     T.tweet_id;`;
  const tweetsArray = await db.all(getTweetsQuery);
  response.send(tweetsArray);
});

//Add post API
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `select user_id from user where username = '${username}';`;
  const userId = await db.get(getUserIdQuery);
  let date = new Date();
  const formatDate = `${date.getFullYear()}-${
    date.getMonth() + 1
  }-${date.getDay()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
  const { tweet } = request.body;
  const createTweetQuery = `
  INSERT INTO
   tweet(tweet,user_id,date_time)
   VALUES(
       '${tweet}',${userId.user_id},'${formatDate}');`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//Delete tweet API
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  authenticatePersonTweet,
  async (request, response) => {
    const { userTweet } = request;
    const { tweetId } = request.params;
    const tweetDeleteQuery = `
   DELETE FROM tweet
    WHERE tweet_id = ${tweetId};`;
    await db.run(tweetDeleteQuery);
    response.send("Tweet Removed");
  }
);

module.exports = app;
