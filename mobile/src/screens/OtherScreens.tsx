import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, FieldRow, PrimaryButton } from "../components/UI";
import { C } from "../theme";

export function TripsScreen({onLive}:{onLive:()=>void}) {
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Viajes</Text>
      <View style={s.segment}>
        <Pressable style={[s.seg,s.segActive]}><Text style={s.segActiveText}>Disponibles</Text></Pressable>
        <Pressable style={s.seg}><Text style={s.segText}>Mis reservas</Text></Pressable>
      </View>
      <Card style={s.tripCard}>
        <View style={s.tripTop}>
          <View style={s.avatar}><Ionicons name="person" size={28} color="#fff"/></View>
          <View style={{flex:1}}>
            <Text style={s.tripName}>Ana</Text>
            <Text style={s.tripMeta}>Conductora · ★ 4,8</Text>
          </View>
          <View style={s.badge}><Text style={s.badgeText}>2 plazas</Text></View>
        </View>
        <View style={s.routeLine}><Ionicons name="location" size={19} color={C.blue}/><Text style={s.routeText}>Mairena del Aljarafe → Sevilla</Text></View>
        <View style={s.smallRow}><Text style={s.small}>Recogida estimada · 8 min</Text><Text style={s.small}>Desvío · 3 min</Text></View>
        <PrimaryButton title="Ver viaje" onPress={onLive}/>
      </Card>
      <Card style={s.tripCard}>
        <View style={s.tripTop}>
          <View style={[s.avatar,{backgroundColor:"#8FB8D9"}]}><Ionicons name="person" size={28} color="#fff"/></View>
          <View style={{flex:1}}>
            <Text style={s.tripName}>Laura</Text>
            <Text style={s.tripMeta}>Conductora · ★ 4,9</Text>
          </View>
          <View style={s.badge}><Text style={s.badgeText}>1 plaza</Text></View>
        </View>
        <View style={s.routeLine}><Ionicons name="location" size={19} color={C.blue}/><Text style={s.routeText}>Coria del Río → Sevilla</Text></View>
        <PrimaryButton title="Solicitar plaza"/>
      </Card>
    </ScrollView>
  );
}

export function PublishScreen() {
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Publicar viaje</Text>
      <Text style={s.subtitle}>Configura un recorrido dentro de tu provincia.</Text>
      <Card style={{paddingVertical:0}}>
        <FieldRow icon="location" title="Provincia" value="Sevilla"/>
        <FieldRow icon="navigate" title="Origen" value="Palomares del Río"/>
        <FieldRow icon="flag" title="Destino" value="Sevilla"/>
        <FieldRow icon="calendar" title="Fecha" value="Elegir"/>
        <FieldRow icon="time" title="Hora" value="08:00"/>
        <FieldRow icon="people" title="Plazas" value="3"/>
      </Card>
      <View style={s.ok}><Ionicons name="shield-checkmark" size={23} color={C.mint}/><Text style={s.okText}>El recorrido completo se validará dentro de la provincia antes de publicar.</Text></View>
      <PrimaryButton title="Calcular ruta y precio"/>
    </ScrollView>
  );
}

export function MessagesScreen() {
  const rows=[
    ["Ana","Llego en unos 8 min","2 min"],
    ["Miguel","Perfecto, nos vemos en el punto","18 min"],
    ["Laura","He aceptado tu solicitud","Ayer"],
  ];
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Mensajes</Text>
      <Text style={s.subtitle}>Conversaciones vinculadas a tus viajes y reservas.</Text>
      {rows.map(([name,msg,time])=>(
        <Card key={name} style={s.chat}>
          <View style={s.avatar}><Ionicons name="person" size={26} color="#fff"/></View>
          <View style={{flex:1}}>
            <Text style={s.tripName}>{name}</Text>
            <Text style={s.tripMeta} numberOfLines={1}>{msg}</Text>
          </View>
          <Text style={s.time}>{time}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const s=StyleSheet.create({
  wrap:{padding:18,paddingBottom:28,backgroundColor:"#fff"},
  title:{fontSize:25,fontWeight:"900",color:C.navy,textAlign:"center",marginBottom:8},
  subtitle:{fontSize:13,color:C.muted,textAlign:"center",marginBottom:16},
  segment:{flexDirection:"row",gap:8,marginBottom:12},
  seg:{flex:1,height:42,borderRadius:13,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:C.border},
  segActive:{backgroundColor:C.blue,borderColor:C.blue},
  segText:{fontSize:12,fontWeight:"800",color:C.navy},
  segActiveText:{fontSize:12,fontWeight:"800",color:"#fff"},
  tripCard:{marginBottom:12},
  tripTop:{flexDirection:"row",alignItems:"center",gap:10},
  avatar:{width:48,height:48,borderRadius:24,backgroundColor:"#78B89F",alignItems:"center",justifyContent:"center"},
  tripName:{fontSize:16,fontWeight:"900",color:C.navy},
  tripMeta:{fontSize:12,color:C.muted,marginTop:2},
  badge:{backgroundColor:C.pale,borderRadius:10,paddingHorizontal:9,paddingVertical:6},
  badgeText:{fontSize:11,fontWeight:"900",color:C.blue},
  routeLine:{flexDirection:"row",alignItems:"center",gap:8,marginTop:13,paddingVertical:10,borderTopWidth:1,borderTopColor:C.border},
  routeText:{fontSize:13,fontWeight:"800",color:C.navy},
  smallRow:{flexDirection:"row",justifyContent:"space-between"},
  small:{fontSize:11,color:C.muted},
  ok:{marginTop:12,backgroundColor:C.mintPale,borderRadius:14,padding:13,flexDirection:"row",alignItems:"center",gap:9},
  okText:{fontSize:12,color:C.navy,fontWeight:"700",flex:1},
  chat:{marginBottom:10,flexDirection:"row",alignItems:"center",gap:10},
  time:{fontSize:10,color:C.muted},
});
