import React, { useState } from "react";
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomNav } from "./src/components/UI";
import { HomeScreen } from "./src/screens/HomeScreen";
import { RouteScreen } from "./src/screens/RouteScreen";
import { LiveScreen } from "./src/screens/LiveScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { MessagesScreen, PublishScreen, TripsScreen } from "./src/screens/OtherScreens";
import { C } from "./src/theme";

type Screen = "home"|"trips"|"publish"|"messages"|"profile"|"route"|"live";

export default function App() {
  const [screen,setScreen]=useState<Screen>("home");
  const main = ["home","trips","publish","messages","profile"].includes(screen);
  const navActive = main ? screen : screen==="route" ? "home" : "trips";

  const goMain=(next:string)=>{
    if (["home","trips","publish","messages","profile"].includes(next)) {
      setScreen(next as Screen);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff"/>
      {!main ? (
        <View style={s.subHeader}>
          <Pressable onPress={()=>setScreen(screen==="live"?"trips":"home")} style={s.back}>
            <Ionicons name="chevron-back" size={22} color={C.navy}/>
            <Text style={s.backText}>Volver</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={s.body}>
        {screen==="home" && <HomeScreen onOpenRoute={()=>setScreen("route")}/>}
        {screen==="route" && <RouteScreen onLive={()=>setScreen("live")}/>}
        {screen==="live" && <LiveScreen/>}
        {screen==="trips" && <TripsScreen onLive={()=>setScreen("live")}/>}
        {screen==="publish" && <PublishScreen/>}
        {screen==="messages" && <MessagesScreen/>}
        {screen==="profile" && <ProfileScreen/>}
      </View>
      <BottomNav active={navActive} onChange={goMain}/>
    </SafeAreaView>
  );
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:"#fff"},
  body:{flex:1,backgroundColor:"#fff"},
  subHeader:{height:42,justifyContent:"center",paddingHorizontal:14,borderBottomWidth:1,borderBottomColor:"#EEF3FA"},
  back:{flexDirection:"row",alignItems:"center",alignSelf:"flex-start"},
  backText:{fontSize:14,fontWeight:"800",color:C.navy},
});
